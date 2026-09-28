import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Database, capture, removeEntry } from '../src/storage/database';
import { entryRow, listRecords, recordDetail } from '../src/storage/catalog';
import { editMaterial, removeSource } from '../src/storage/mutations';
import { Worker } from '../src/storage/worker';
import { fakeServices, source, material, settings } from './fixtures';

let db: Database;
beforeEach(() => {
  db = new Database(crypto.randomUUID());
  vi.stubGlobal('fetch', fakeServices().fetcher);
});
afterEach(async () => {
  await db.delete();
  vi.unstubAllGlobals();
});

it('serves bounded summaries, searches beyond the first page, and reads details separately', async () => {
  const rows = Array.from({ length: 251 }, (_, i) => {
    const id = `entry-${String(i).padStart(4, '0')}`;
    return entryRow(
      { id, language: 'en', lemma: `term${i}`, sense: 'sense', generationId: id, createdAt: i },
      { id, captureId: id, material: { ...material, lemma: `term${i}` }, createdAt: i },
      [],
    );
  });
  await db.catalog.bulkPut(rows);
  const first = await listRecords(db, '', 0, false);
  const second = await listRecords(db, '', first.next!, false, first.before);
  expect(first.records).toHaveLength(100);
  expect(first.records[0]?.term).toBe('term250');
  expect(new Set([...first.records, ...second.records].map((r) => r.id)).size).toBe(200);
  const last = await listRecords(db, '', 200, false, second.before);
  expect(last.records).toHaveLength(51);
  expect(last.next).toBeUndefined();
  expect((await listRecords(db, 'term0', 0, false)).records[0]?.term).toBe('term0');
  expect(first.records[0]).not.toHaveProperty('tokens');
  expect(first.records[0]).not.toHaveProperty('examples');
});

it('indexes pending captures, updates edits and sources, and removes deleted entries', async () => {
  const id = await capture(db, source);
  expect((await listRecords(db, 'reluct', 0, false)).records[0]?.captureId).toBe(id);
  await new Worker(db, async () => settings).run();
  expect((await recordDetail(db, `capture:${id}`))?.record.entry).toBeDefined();
  const row = (await listRecords(db, '', 0, false)).records[0]!;
  expect(row.entryId).toBeTruthy();
  const detail = await recordDetail(db, row.id);
  expect(detail?.sources).toHaveLength(1);
  expect(detail?.record.generation?.material.examples).toHaveLength(3);
  await editMaterial(db, row.entryId!, { ...material, gloss: 'hesitation' });
  expect((await listRecords(db, 'hesit', 0, false)).records).toHaveLength(1);
  await removeSource(db, id);
  expect((await recordDetail(db, row.id))?.sources).toHaveLength(0);
  expect((await listRecords(db, '', 0, false)).records).toHaveLength(1);
  await removeEntry(db, row.entryId!, false);
  expect((await listRecords(db, '', 0, false)).records).toHaveLength(0);
});

it('paginates large source collections without returning all saved sentences', async () => {
  await capture(db, source);
  await new Worker(db, async () => settings).run();
  const row = (await listRecords(db, '', 0, false)).records[0]!;
  await db.captures.bulkPut(
    Array.from({ length: 45 }, (_, i) => ({ id: `extra-${i}`, entryId: row.entryId, source, createdAt: i })),
  );
  expect((await recordDetail(db, row.id))?.sources).toHaveLength(20);
  expect((await recordDetail(db, row.id))?.moreSources).toBe(true);
  expect((await recordDetail(db, row.id, 40))?.sources).toHaveLength(6);
  expect((await recordDetail(db, row.id, 40))?.moreSources).toBe(false);
});
