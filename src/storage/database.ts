import Dexie, { type EntityTable } from 'dexie';
import type { CatalogRow } from '../domain/records';
import { buildCatalog, captureRow } from './catalog';
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
} from '../domain/model';

export class Database extends Dexie {
  captures!: EntityTable<Capture, 'id'>;
  entries!: EntityTable<Entry, 'id'>;
  generations!: EntityTable<Generation, 'id'>;
  vocabulary!: EntityTable<Vocabulary, 'id'>;
  jobs!: EntityTable<Job, 'id'>;
  catalog!: EntityTable<CatalogRow, 'id'>;
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
  await db.transaction('rw', db.captures, db.entries, db.jobs, db.catalog, async () => {
    const previous = await db.captures.get(id);
    if (previous && !previous.deleted) return;
    const entry = previous?.entryId ? await db.entries.get(previous.entryId) : undefined;
    const next: Capture = {
      id,
      source,
      createdAt: Date.now(),
      restoreToken: entry?.deleted ? entry.deleteToken : undefined,
    };
    await db.captures.put(next);
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
  return { capture: c, entry, generation, job, state: word?.state };
}
export async function removeEntry(db: Database, id: string, deleteAnki: boolean) {
  await db.transaction('rw', db.entries, db.captures, db.jobs, db.catalog, async () => {
    if (!(await db.entries.get(id))) return;
    await db.entries.update(id, { deleted: true, deletedAt: Date.now(), deleteToken: crypto.randomUUID() });
    await db.captures.where('entryId').equals(id).modify({ deleted: true });
    await db.jobs.delete(`export:${id}`);
    await db.catalog.delete(`entry:${id}`);
    if (deleteAnki) await queue(db, 'delete', id);
  });
}
