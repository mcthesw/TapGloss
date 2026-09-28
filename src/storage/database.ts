import Dexie, { type EntityTable } from 'dexie';
import type { CatalogRow } from '../domain/records';
import { buildCatalog, captureRow } from './catalog';
import { track, upgradeSync, type PendingChange, type SyncShard, type SyncMeta } from './changes';
import { deletion } from '../domain/sync';
import {
  captureId,
  vocabularyId,
  type Capture,
  type Entry,
  type Generation,
  type Job,
  type RecordView,
  type Source,
  type Vocabulary,
  type AnkiBinding,
} from '../domain/model';

export class Database extends Dexie {
  captures!: EntityTable<Capture, 'id'>;
  entries!: EntityTable<Entry, 'id'>;
  generations!: EntityTable<Generation, 'id'>;
  vocabulary!: EntityTable<Vocabulary, 'id'>;
  jobs!: EntityTable<Job, 'id'>;
  catalog!: EntityTable<CatalogRow, 'id'>;
  ankiBindings!: EntityTable<AnkiBinding, 'id'>;
  syncChanges!: EntityTable<PendingChange, 'id'>;
  syncShards!: EntityTable<SyncShard, 'id'>;
  syncMeta!: EntityTable<SyncMeta, 'id'>;
  constructor(name = 'TapGloss') {
    super(name);
    this.version(1).stores({
      captures: 'id,entryId,createdAt',
      entries: 'id,lemma,createdAt',
      generations: 'id,captureId',
      vocabulary: 'id',
      jobs: 'id,nextAt',
    });
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        // Re-render existing owned notes without changing identity or review history.
        const entries = await tx.table<Entry>('entries').toArray();
        const jobs = tx.table<Job>('jobs');
        for (const entry of entries) {
          const id = `export:${entry.id}`;
          if (!entry.deleted && !(await jobs.get(id)))
            await jobs.put({
              id,
              kind: 'export',
              ref: entry.id,
              token: crypto.randomUUID(),
              attempts: 0,
              nextAt: 0,
              leaseUntil: 0,
            });
        }
      });
    this.version(3)
      .stores({
        catalog: 'id,entryId,[createdAt+id],*tokens',
        vocabulary: 'id,*forms',
        jobs: 'id,nextAt,kind',
      })
      .upgrade(buildCatalog);
    this.version(4)
      .stores({
        entries: 'id,lemma,createdAt,generationId',
        ankiBindings: 'id',
        syncChanges: 'id,shard',
        syncShards: 'id,upload',
        syncMeta: 'id',
      })
      .upgrade(upgradeSync);
  }
}
export function queue(db: Database, kind: Job['kind'], ref: string) {
  return db.jobs.put({
    id: `${kind}:${ref}`,
    kind,
    ref,
    token: crypto.randomUUID(),
    attempts: 0,
    nextAt: 0,
    leaseUntil: 0,
  });
}
export async function capture(db: Database, source: Source) {
  const id = await captureId(source);
  await db.transaction('rw', [db.captures, db.entries, db.jobs, db.catalog, db.syncChanges], async (tx) => {
    const previous = await db.captures.get(id);
    if (previous && !previous.deleted) return;
    const entry = previous?.entryId ? await db.entries.get(previous.entryId) : undefined;
    const next: Capture = {
      id,
      source,
      createdAt: Date.now(),
      restoreDeletions: entry?.deleted ? entry.deletions : undefined,
      deletions: previous?.deletions,
      acknowledged: previous?.deletions,
    };
    await db.captures.put(next);
    await track(tx, 'captures', previous, next);
    await db.catalog.put(captureRow(next));
    await queue(db, 'generate', id);
  });
  return id;
}
export async function view(
  db: Database,
  id: string,
  includeRemovedSource = false,
): Promise<RecordView | undefined> {
  const c = await db.captures.get(id);
  if (!c || (c.deleted && !includeRemovedSource)) return;
  const entry = c.entryId ? await db.entries.get(c.entryId) : undefined;
  const generation = entry ? await db.generations.get(entry.generationId) : undefined;
  const word = entry ? await db.vocabulary.get(vocabularyId(entry.language, entry.lemma)) : undefined;
  const job = await db.jobs.get(entry ? `export:${entry.id}` : `generate:${id}`);
  const binding = entry && (await db.ankiBindings.get(entry.id));
  return { capture: c, entry: entry && { ...entry, ...binding }, generation, job, state: word?.state };
}
export async function removeEntry(db: Database, id: string, deleteAnki: boolean) {
  await db.transaction('rw', [db.entries, db.captures, db.jobs, db.catalog, db.syncChanges], async (tx) => {
    const before = await db.entries.get(id);
    if (!before) return;
    const next = { ...before, ...deletion(before), deletedAt: Date.now() };
    await db.entries.put(next);
    await track(tx, 'entries', before, next);
    for (const c of await db.captures.where('entryId').equals(id).toArray()) {
      const removed = { ...c, ...deletion(c) };
      await db.captures.put(removed);
      await track(tx, 'captures', c, removed);
    }
    await db.jobs.delete(`export:${id}`);
    await db.catalog.delete(`entry:${id}`);
    if (deleteAnki) await queue(db, 'delete', id);
  });
}

export async function setVocabularyState(db: Database, id: string, state: Vocabulary['state']) {
  await db.transaction('rw', [db.vocabulary, db.syncChanges], async (tx) => {
    const before = await db.vocabulary.get(id);
    if (!before) return;
    const next = { ...before, state };
    await db.vocabulary.put(next);
    await track(tx, 'vocabulary', before, next);
  });
}
