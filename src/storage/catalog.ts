import type { Table, Transaction } from 'dexie';
import { type Capture, type Entry, type Generation, vocabularyId } from '../domain/model';
import {
  type CatalogRow,
  type RecordDetail,
  type RecordPage,
  pageSize,
  searchTokens,
} from '../domain/records';
import type { Database } from './database';

export function captureRow(c: Capture): CatalogRow {
  return {
    id: `capture:${c.id}`,
    captureId: c.id,
    term: c.source.sentence.slice(c.source.start, c.source.end),
    gloss: '',
    createdAt: c.createdAt,
    tokens: searchTokens(c.source.sentence),
  };
}
export function entryRow(e: Entry, g: Generation, sources: Capture[]): CatalogRow {
  return {
    id: `entry:${e.id}`,
    entryId: e.id,
    captureId: g.captureId,
    term: g.material.lemma,
    gloss: g.material.gloss,
    language: e.language,
    createdAt: e.createdAt,
    tokens: searchTokens([e.lemma, g.material.gloss, ...sources.map((c) => c.source.sentence)].join(' ')),
  };
}
export async function updateCatalog(db: Database, id: string) {
  const e = await db.entries.get(id);
  if (!e || e.deleted) {
    await db.catalog.delete(`entry:${id}`);
    return;
  }
  const g = await db.generations.get(e.generationId);
  if (!g) return;
  const sources = await db.captures
    .where('entryId')
    .equals(id)
    .filter((c) => !c.deleted)
    .toArray();
  await db.catalog.put(entryRow(e, g, sources));
}

// Upgrade once, in bounded batches. Existing records and note identities stay intact.
export async function buildCatalog(tx: Transaction) {
  const captures = tx.table<Capture>('captures'),
    entries = tx.table<Entry>('entries');
  const generations = tx.table<Generation>('generations'),
    catalog = tx.table<CatalogRow>('catalog');
  async function batches<T extends { id: string }>(table: Table<T>, visit: (rows: T[]) => Promise<void>) {
    let last = '';
    while (true) {
      const rows = await table.where('id').above(last).limit(250).toArray();
      if (!rows.length) break;
      await visit(rows);
      last = rows.at(-1)!.id;
    }
  }
  await batches(captures, async (rows) => {
    const pending = rows.filter((c) => !c.deleted && !c.entryId).map(captureRow);
    if (pending.length) await catalog.bulkPut(pending);
  });
  await batches(entries, async (rows) => {
    const active = rows.filter((e) => !e.deleted);
    const materials = await generations.bulkGet(active.map((e) => e.generationId));
    const sources = await captures
      .where('entryId')
      .anyOf(active.map((e) => e.id))
      .toArray();
    const grouped = new Map<string, Capture[]>();
    for (const c of sources)
      if (!c.deleted && c.entryId) grouped.set(c.entryId, [...(grouped.get(c.entryId) ?? []), c]);
    const result = active.flatMap((e, i) =>
      materials[i] ? [entryRow(e, materials[i]!, grouped.get(e.id) ?? [])] : [],
    );
    if (result.length) await catalog.bulkPut(result);
  });
}

export async function listRecords(
  db: Database,
  query: string,
  offset: number,
  examples: boolean,
  before?: [number, string],
): Promise<RecordPage> {
  const terms = searchTokens(query);
  const collection = terms.length
    ? db.catalog
        .where('tokens')
        .startsWith([...terms].sort((a, b) => b.length - a.length)[0]!)
        .distinct()
        .filter((row) => terms.every((term) => row.tokens.some((token) => token.startsWith(term))))
    : before
      ? db.catalog.where('[createdAt+id]').below(before).reverse()
      : db.catalog.orderBy('[createdAt+id]').reverse();
  const found = await collection
    .offset(!terms.length && before ? 0 : offset)
    .limit(pageSize + 1)
    .toArray();
  const rows = found.slice(0, pageSize);
  const [entries, words, jobs] = await Promise.all([
    db.entries.bulkGet(rows.map((r) => r.entryId ?? '')),
    db.vocabulary.bulkGet(rows.map((r) => vocabularyId(r.language ?? '', r.term))),
    db.jobs.bulkGet(rows.map((r) => (r.entryId ? `export:${r.entryId}` : `generate:${r.captureId}`))),
  ]);
  const generations = examples ? await db.generations.bulkGet(entries.map((e) => e?.generationId ?? '')) : [];
  return {
    records: rows.map(({ tokens: _tokens, ...r }, i) => ({
      ...r,
      state: words[i]?.state,
      job: jobs[i],
      exported: !!entries[i]?.noteId,
      ...(examples && generations[i] ? { examples: generations[i]!.material.examples } : {}),
    })),
    next: found.length > pageSize ? offset + pageSize : undefined,
    before: rows.length && !terms.length ? [rows.at(-1)!.createdAt, rows.at(-1)!.id] : undefined,
  };
}
export async function recordDetail(
  db: Database,
  id: string,
  sourceOffset = 0,
): Promise<RecordDetail | undefined> {
  let row = await db.catalog.get(id);
  if (!row && id.startsWith('capture:')) {
    const capture = await db.captures.get(id.slice('capture:'.length));
    if (capture?.entryId && !capture.deleted) row = await db.catalog.get(`entry:${capture.entryId}`);
  }
  if (!row) return;
  const entry = row.entryId ? await db.entries.get(row.entryId) : undefined;
  const generation = entry ? await db.generations.get(entry.generationId) : undefined;
  const capture = await db.captures.get(row.captureId);
  if (!capture || entry?.deleted) return;
  const sources = entry
    ? await db.captures
        .where('entryId')
        .equals(entry.id)
        .filter((c) => !c.deleted)
        .offset(sourceOffset)
        .limit(21)
        .toArray()
    : [capture];
  const word = entry ? await db.vocabulary.get(vocabularyId(entry.language, entry.lemma)) : undefined;
  const job = await db.jobs.get(entry ? `export:${entry.id}` : `generate:${capture.id}`);
  return {
    record: { capture, entry, generation, state: word?.state, job },
    sources: sources.slice(0, 20),
    moreSources: sources.length > 20,
  };
}
