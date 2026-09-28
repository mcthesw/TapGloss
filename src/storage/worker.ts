import { hash, normalize, vocabularyId, type Job, type Settings, type Entry } from '../domain/model';
import { Anki, noteFields } from '../anki/client';
import { explain, matchSense } from '../explain/client';
import { Database, queue } from './database';
import { updateCatalog } from './catalog';
import { ServiceFailure } from '../domain/failure';

export class Worker {
  private running?: Promise<void>;
  constructor(
    private db: Database,
    private settings: () => Promise<Settings>,
    private changed: (vocabulary: boolean) => void = () => {},
  ) {}
  run() {
    return (this.running ??= this.drain().finally(() => {
      this.running = undefined;
    }));
  }
  private async claim() {
    return this.db.transaction('rw', this.db.jobs, async () => {
      const job = await this.db.jobs
        .where('nextAt')
        .belowOrEqual(Date.now())
        .filter((j) => !j.blocked && j.leaseUntil <= Date.now())
        .first();
      if (job) await this.db.jobs.update(job.id, { leaseUntil: Date.now() + 180000 });
      return job;
    });
  }
  private async drain() {
    const prepared = new Set<string>();
    let job: Job | undefined;
    while ((job = await this.claim())) {
      try {
        const settings = await this.settings();
        if (job.kind === 'generate') await this.generate(job, settings);
        else await this.export(job, settings, prepared);
        await this.db.transaction('rw', this.db.jobs, async () => {
          if ((await this.db.jobs.get(job!.id))?.token === job!.token) await this.db.jobs.delete(job!.id);
        });
      } catch (error) {
        const message =
          error instanceof Error && !(error.name === 'ZodError')
            ? error.message
            : '返回数据不符合要求，请重试';
        await this.db.transaction('rw', this.db.jobs, async () => {
          if ((await this.db.jobs.get(job!.id))?.token !== job!.token) return;
          await this.db.jobs.update(job!.id, {
            error: message,
            attempts: job!.attempts + 1,
            leaseUntil: 0,
            blocked: !(error instanceof ServiceFailure && error.retryable && job!.attempts < 4),
            nextAt:
              error instanceof ServiceFailure && error.retryable && job!.attempts < 4
                ? Date.now() + Math.min(3600000, 60000 * 2 ** job!.attempts)
                : Number.MAX_SAFE_INTEGER,
          });
        });
      }
      this.changed(job.kind === 'generate');
    }
  }
  private async generate(job: Job, settings: Settings) {
    const c = await this.db.captures.get(job.ref);
    if (!c || c.deleted) return;
    const material = await explain(settings, c.source);
    const candidates = await this.db.entries.where('lemma').equals(normalize(material.lemma)).toArray();
    const match = await matchSense(settings, material, candidates);
    const generation = { id: crypto.randomUUID(), captureId: c.id, material, createdAt: Date.now() };
    const fresh: Entry = {
      id: crypto.randomUUID(),
      language: material.language,
      lemma: normalize(material.lemma),
      sense: material.sense,
      generationId: generation.id,
      createdAt: Date.now(),
    };
    await this.db.transaction(
      'rw',
      [
        this.db.captures,
        this.db.generations,
        this.db.entries,
        this.db.vocabulary,
        this.db.jobs,
        this.db.catalog,
      ],
      async () => {
        if (
          (await this.db.captures.get(c.id))?.deleted ||
          (await this.db.jobs.get(job.id))?.token !== job.token
        )
          return;
        const entry = match ? await this.db.entries.get(match.id) : fresh;
        if (!entry) return;
        if (entry.deleted) {
          const explicitRestore = !!c.restoreToken && c.restoreToken === entry.deleteToken;
          if (!explicitRestore && c.createdAt <= (entry.deletedAt ?? 0))
            throw new Error('条目已删除，请重新查询');
          if (await this.db.jobs.get(`delete:${entry.id}`)) throw new Error('请等待 Anki 删除完成后重试');
          entry.deleted = false;
          entry.deletedAt = undefined;
          entry.deleteToken = undefined;
          entry.generationId = generation.id;
        }
        await this.db.generations.add(generation);
        await this.db.entries.put(entry);
        await this.db.captures.update(c.id, { entryId: entry.id });
        await this.db.catalog.delete(`capture:${c.id}`);
        await updateCatalog(this.db, entry.id);
        const id = vocabularyId(entry.language, entry.lemma);
        const old = await this.db.vocabulary.get(id);
        const forms = [
          ...new Set([...(old?.forms ?? []), normalize(material.sourceTarget), normalize(entry.lemma)]),
        ];
        await this.db.vocabulary.put({
          id,
          language: entry.language,
          lemma: entry.lemma,
          forms,
          state: old?.state ?? 'learning',
        });
        await queue(this.db, 'export', entry.id);
      },
    );
  }
  private async export(job: Job, settings: Settings, prepared: Set<string>) {
    const entry = await this.db.entries.get(job.ref);
    if (!entry || (job.kind === 'export' && entry.deleted)) return;
    const anki = new Anki(settings);
    if (job.kind === 'delete') {
      const note = await anki.find(entry);
      if (note) await anki.call('deleteNotes', { notes: [note.noteId] });
      await this.db.entries.update(entry.id, {
        noteId: undefined,
        syncedHash: undefined,
        pendingHash: undefined,
      });
      return;
    }
    const generation = await this.db.generations.get(entry.generationId);
    if (!generation) throw new Error('未找到学习材料');
    const captures = (await this.db.captures.where('entryId').equals(entry.id).sortBy('createdAt')).filter(
      (c) => !c.deleted,
    );
    const values = noteFields(entry, generation.material, captures);
    const nextHash = await hash(values);
    const connection = JSON.stringify([settings.ankiUrl, settings.ankiKey, settings.deck]);
    if (!prepared.has(connection)) {
      await anki.setup();
      prepared.add(connection);
    }
    const note = await anki.find(entry);
    if (note) {
      const currentHash = await anki.fieldHash(note);
      if (currentHash !== nextHash && currentHash !== entry.syncedHash && currentHash !== entry.pendingHash)
        throw new Error('Anki 内容已被修改，自动更新已暂停');
      await this.db.entries.update(entry.id, { pendingHash: nextHash });
      if (currentHash !== nextHash)
        await anki.call('updateNoteFields', { note: { id: note.noteId, fields: values } });
      await this.db.entries.update(entry.id, {
        noteId: note.noteId,
        syncedHash: nextHash,
        pendingHash: undefined,
      });
    } else {
      if (entry.noteId) throw new Error('关联笔记已移除，未自动重新创建');
      await this.db.entries.update(entry.id, { pendingHash: nextHash });
      const noteId = await anki.create(values);
      await this.db.entries.update(entry.id, { noteId, syncedHash: nextHash, pendingHash: undefined });
    }
  }
}
