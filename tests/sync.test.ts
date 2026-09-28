import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Database, capture, removeEntry, setVocabularyState, queue } from '../src/storage/database';
import { Worker } from '../src/storage/worker';
import { editMaterial, removeSource } from '../src/storage/mutations';
import { SyncEngine } from '../src/sync/engine';
import { applySnapshot, records, snapshot } from '../src/sync/document';
import type { RemoteStore } from '../src/sync/transport';
import { fakeServices, material, settings, source } from './fixtures';

class MemoryRemote implements RemoteStore {
  files = new Map<string, { data: Uint8Array; revision: string }>();
  writes = 0;
  failAfterWrite = false;
  async list() {
    return [...this.files].map(([key, f]) => ({ key, revision: f.revision }));
  }
  async get(key: string) {
    return this.files.get(key)!.data.slice();
  }
  async put(key: string, data: Uint8Array) {
    this.files.set(key, { data: data.slice(), revision: String(++this.writes) });
    if (this.failAfterWrite) {
      this.failAfterWrite = false;
      throw new Error('connection lost');
    }
  }
}
let a: Database, b: Database, remote: MemoryRemote;
let services: ReturnType<typeof fakeServices>;
const sync = (db: Database) => new SyncEngine(db).run(remote, 'test-workspace');
const generate = (db: Database) => new Worker(db, async () => settings).run();
beforeEach(() => {
  a = new Database(crypto.randomUUID());
  b = new Database(crypto.randomUUID());
  remote = new MemoryRemote();
  services = fakeServices();
  vi.stubGlobal('fetch', services.fetcher);
});
afterEach(async () => {
  await a.delete();
  await b.delete();
  vi.unstubAllGlobals();
});

it('syncs reading data but never transfers credentials, jobs or Anki bindings; unchanged replicas do not echo uploads', async () => {
  await capture(a, source);
  await generate(a);
  await sync(a);
  await sync(b);
  await sync(a);
  expect(await b.entries.toArray()).toEqual(await a.entries.toArray());
  expect(await b.vocabulary.toArray()).toEqual(await a.vocabulary.toArray());
  expect(await b.ankiBindings.count()).toBe(0);
  expect(await b.jobs.count()).toBe(0);
  expect(await b.catalog.count()).toBe(1);
  const writes = remote.writes;
  await sync(a);
  await sync(b);
  expect(remote.writes).toBe(writes);
  const entry = (await b.entries.toArray())[0]!;
  await editMaterial(b, entry.id, { ...material, gloss: 'corrected on second device' });
  await generate(b);
  expect(services.counts().adds).toBe(1);
  await sync(b);
  await sync(a);
  await generate(a);
  expect(services.counts().adds).toBe(1);
  expect(services.notes.get(1)?.fields.Extra).toContain('corrected on second device');
  for (const [key, file] of remote.files) {
    const doc = new Y.Doc();
    applySnapshot(doc, file.data);
    const text = JSON.stringify(records(doc, key.slice(0, 2)));
    expect(text).not.toMatch(/noteId|syncedHash|apiKey|password|leaseUntil/);
    doc.destroy();
  }
});

it('converges concurrent independent edits and preserves complete generation batches', async () => {
  await capture(a, source);
  await generate(a);
  await sync(a);
  await sync(b);
  const entry = (await a.entries.toArray())[0]!;
  const word = (await a.vocabulary.toArray())[0]!;
  await editMaterial(a, entry.id, { ...material, gloss: 'A version' });
  await editMaterial(b, entry.id, { ...material, gloss: 'B version' });
  await setVocabularyState(a, word.id, 'known');
  await removeSource(b, (await b.captures.toArray())[0]!.id);
  await sync(b);
  await sync(a);
  await sync(b);
  expect(await a.entries.toArray()).toEqual(await b.entries.toArray());
  expect(await a.generations.count()).toBe(3);
  expect(await b.generations.count()).toBe(3);
  expect((await b.vocabulary.get(word.id))?.state).toBe('known');
  expect((await a.captures.toArray())[0]?.deleted).toBe(true);
  expect(await a.catalog.count()).toBe(1);
});

it('keeps deletion after stale edits, duplicate delivery and an offline device returning', async () => {
  await capture(a, source);
  await generate(a);
  await sync(a);
  await sync(b);
  const entry = (await a.entries.toArray())[0]!;
  await removeEntry(a, entry.id, false);
  await editMaterial(b, entry.id, { ...material, gloss: 'stale offline edit' });
  await sync(a);
  await sync(b);
  await sync(a);
  expect((await b.entries.get(entry.id))?.deleted).toBe(true);
  expect(await a.catalog.count()).toBe(0);
  expect(await b.catalog.count()).toBe(0);
  expect(services.notes.size).toBe(1);
  await capture(b, source);
  await generate(b);
  await sync(b);
  await sync(a);
  expect((await a.entries.get(entry.id))?.deleted).toBeFalsy();
  expect(await a.catalog.count()).toBe(1);
  expect(await b.ankiBindings.count()).toBe(0);
});

it('does not acknowledge a concurrent deletion that a restoring device has never seen', async () => {
  await capture(a, source);
  await generate(a);
  await sync(a);
  await sync(b);
  const entry = (await a.entries.toArray())[0]!;
  await removeEntry(a, entry.id, false);
  await sync(a);
  await sync(b);
  await capture(a, source);
  await generate(a);
  await removeEntry(b, entry.id, false);
  await sync(a);
  await sync(b);
  await sync(a);
  expect((await a.entries.get(entry.id))?.deleted).toBe(true);
  expect((await b.entries.get(entry.id))?.deleted).toBe(true);
});

it('resumes an ambiguous upload without losing durable local edits', async () => {
  await capture(a, source);
  await generate(a);
  remote.failAfterWrite = true;
  await expect(sync(a)).rejects.toThrow('connection lost');
  expect(await a.syncShards.where('upload').equals(1).count()).toBe(1);
  await sync(a);
  await sync(b);
  expect(await b.entries.count()).toBe(1);
  expect(await b.catalog.count()).toBe(1);
  expect(await a.syncChanges.count()).toBe(0);
});

it('rejects invalid remote fields atomically and keeps the local outbox', async () => {
  await capture(a, source);
  const change = (await a.syncChanges.toArray())[0]!;
  const doc = new Y.Doc();
  doc.getMap(change.id).set('apiKey', 'must not enter shared records');
  await remote.put(`${change.shard}-${crypto.randomUUID()}.bin`, snapshot(doc));
  doc.destroy();
  await expect(sync(a)).rejects.toThrow();
  expect(await a.captures.count()).toBe(1);
  expect(await a.syncChanges.count()).toBe(1);
  expect(await a.syncShards.count()).toBe(0);
});

it('keeps edits made while an upload is in flight for the next exchange', async () => {
  await capture(a, source);
  await generate(a);
  const put = remote.put.bind(remote);
  let changed = false;
  remote.put = async (key, data) => {
    if (!changed) {
      changed = true;
      await setVocabularyState(a, 'en:reluctant', 'known');
    }
    await put(key, data);
  };
  await sync(a);
  await sync(a);
  await sync(b);
  expect((await b.vocabulary.get('en:reluctant'))?.state).toBe('known');
});

it('exports a newer remote edit even if an older Anki write is already in flight', async () => {
  await capture(a, source);
  await generate(a);
  await sync(a);
  await sync(b);
  const entry = (await a.entries.toArray())[0]!;
  await editMaterial(b, entry.id, { ...material, gloss: 'latest remote material' });
  await sync(b);
  await queue(a, 'export', entry.id);
  let injected = false;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    if (!injected && JSON.parse(String(init.body)).action === 'findNotes') {
      injected = true;
      await sync(a);
    }
    return services.fetcher(input, init);
  });
  await generate(a);
  expect(services.notes.get(1)?.fields.Extra).toContain('latest remote material');
  expect(await a.jobs.count()).toBe(0);
  expect(services.counts().adds).toBe(1);
});
