import { expect, it } from 'vitest';
import { Database, capture, removeEntry, setVocabularyState } from '../src/storage/database';
import { Worker } from '../src/storage/worker';
import { exportBackup, inspectBackup, restoreBackup } from '../src/backup/service';
import { importWordlist } from '../src/storage/wordlists';
import { repairCatalog, project } from '../src/sync/projection';
import { applySnapshot, records, applyChanges, snapshot } from '../src/sync/document';
import { backupShards, packBackup } from '../src/backup/file';
import { shardFor } from '../src/storage/changes';
import * as Y from 'yjs';
import { source, settings, fakeServices } from './fixtures';

it('restores records, wordlists and Anki identity locally and repeated restore is idempotent', async () => {
  const from = new Database(crypto.randomUUID()),
    to = new Database(crypto.randomUUID());
  const original = globalThis.fetch,
    services = fakeServices();
  globalThis.fetch = services.fetcher as typeof fetch;
  try {
    await capture(from, source);
    await new Worker(from, async () => settings).run();
    await importWordlist(from, { name: 'Common', mode: 'exclude', terms: ['a', 'word'] });
    const entry = (await from.entries.toArray())[0]!;
    const binding = await from.ankiBindings.get(entry.id);
    const backup = await exportBackup(from);
    const parsed = await inspectBackup(backup);
    expect(parsed.header.records).toBe(1);
    expect(parsed.header.wordlists).toBe(1);
    const counts = services.counts();
    await restoreBackup(to, parsed);
    await restoreBackup(to, parsed);
    expect(await to.entries.count()).toBe(1);
    expect(await to.captures.count()).toBe(1);
    expect(await to.catalog.count()).toBe(1);
    expect(await to.wordlistWords.toArray()).toEqual(await from.wordlistWords.toArray());
    expect(await to.ankiBindings.get(entry.id)).toEqual(binding);
    expect(await to.jobs.count()).toBe(0);
    await to.ankiBindings.put({ id: entry.id, noteId: 999 });
    await restoreBackup(to, parsed);
    expect((await to.ankiBindings.get(entry.id))?.noteId).toBe(999);
    expect(services.counts()).toEqual(counts);
    expect(parsed.header).not.toHaveProperty('settings');
    expect(parsed.header).not.toHaveProperty('jobs');
    expect(new TextDecoder().decode(await backup.arrayBuffer())).not.toContain('test-only');
  } finally {
    globalThis.fetch = original;
    await from.delete();
    await to.delete();
  }
});

it('repairs an interrupted initial restore without scheduling Anki writes', async () => {
  const from = new Database(crypto.randomUUID()),
    to = new Database(crypto.randomUUID());
  const original = globalThis.fetch;
  globalThis.fetch = fakeServices().fetcher as typeof fetch;
  try {
    await capture(from, source);
    await new Worker(from, async () => settings).run();
    const backup = await inspectBackup(await exportBackup(from));
    for await (const shard of backupShards(backup)) {
      const doc = new Y.Doc();
      try {
        applySnapshot(doc, shard.bytes);
        await to.transaction('rw', to.tables, async () => {
          await project(to, records(doc, shard.id), 'initialRestore');
          await to.syncShards.put({ id: shard.id, bytes: shard.bytes, upload: 1 });
        });
      } finally {
        doc.destroy();
      }
    }
    expect(await to.syncMeta.get('backup:catalog')).toBeDefined();
    await to.ankiBindings.bulkPut(backup.header.bindings);
    await repairCatalog(to);
    expect(await to.syncMeta.get('backup:catalog')).toBeUndefined();
    expect(await to.catalog.count()).toBe(1);
    expect(await to.jobs.count()).toBe(0);
    await restoreBackup(to, backup);
    expect(await to.catalog.count()).toBe(1);
    expect(await to.jobs.count()).toBe(0);
  } finally {
    globalThis.fetch = original;
    await from.delete();
    await to.delete();
  }
});

it('restores unfinished Anki exports as blocked jobs and never replays deletion jobs', async () => {
  const from = new Database(crypto.randomUUID()),
    to = new Database(crypto.randomUUID());
  const original = globalThis.fetch,
    services = fakeServices();
  services.offline(true);
  globalThis.fetch = services.fetcher as typeof fetch;
  try {
    await capture(from, source);
    await new Worker(from, async () => settings).run();
    await from.jobs.put({
      id: 'delete:old',
      kind: 'delete',
      ref: 'old',
      token: 'old',
      attempts: 0,
      nextAt: 0,
      leaseUntil: 0,
    });
    const parsed = await inspectBackup(await exportBackup(from));
    await restoreBackup(to, parsed);
    const jobs = await to.jobs.toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'export', blocked: true });
    const before = services.counts();
    await new Worker(to, async () => settings).run();
    expect(services.counts()).toEqual(before);
  } finally {
    globalThis.fetch = original;
    await from.delete();
    await to.delete();
  }
});

it('an older backup preserves newer local reading states and deletions', async () => {
  const db = new Database(crypto.randomUUID());
  const original = globalThis.fetch;
  globalThis.fetch = fakeServices().fetcher as typeof fetch;
  try {
    await capture(db, source);
    await new Worker(db, async () => settings).run();
    const entry = (await db.entries.toArray())[0]!;
    const backup = await inspectBackup(await exportBackup(db));
    const word = (await db.vocabulary.toArray())[0]!;
    await setVocabularyState(db, word.id, 'known');
    await removeEntry(db, entry.id, false);
    await restoreBackup(db, backup);
    expect((await db.vocabulary.get(word.id))?.state).toBe('known');
    expect((await db.entries.get(entry.id))?.deleted).toBe(true);
    expect(await db.catalog.count()).toBe(0);
    expect(await db.jobs.count()).toBe(0);
  } finally {
    globalThis.fetch = original;
    await db.delete();
  }
});

it('validates the whole file before any restore and pauses unfinished work', async () => {
  const from = new Database(crypto.randomUUID()),
    to = new Database(crypto.randomUUID());
  try {
    await capture(from, source);
    await importWordlist(from, { name: 'Pending', mode: 'exclude', terms: ['word'] });
    const file = await exportBackup(from);
    const valid = await inspectBackup(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    bytes[bytes.length - 1]! ^= 1;
    await expect(restoreBackup(to, { ...valid, file: new Blob([bytes]) })).rejects.toThrow('备份文件');
    expect(await to.captures.count()).toBe(0);
    expect(await to.syncShards.count()).toBe(0);
    await expect(inspectBackup(file.slice(0, file.size - 1))).rejects.toThrow('备份文件');
    await expect(inspectBackup(new Blob(['{}']))).rejects.toThrow('备份文件');
    await restoreBackup(to, valid);
    expect((await to.jobs.toArray())[0]?.blocked).toBe(true);
    expect(await to.catalog.count()).toBe(1);
  } finally {
    await from.delete();
    await to.delete();
  }
});

it('applies deletion-only Yjs updates even when the state vector is unchanged', async () => {
  const db = new Database(crypto.randomUUID()),
    doc = new Y.Doc();
  const key = 'captures:sample',
    shard = shardFor(key);
  const file = () =>
    packBackup({ createdAt: Date.now(), records: 0, wordlists: 0, bindings: [] }, [
      { id: shard, bytes: snapshot(doc) },
    ]);
  try {
    applyChanges(doc, [
      {
        id: key,
        shard,
        table: 'captures',
        key: 'sample',
        patch: { id: 'sample', source, entryId: 'linked', createdAt: 1 },
      },
    ]);
    await restoreBackup(db, await inspectBackup(await file()));
    const vector = Y.encodeStateVector(doc);
    doc.getMap(key).delete('entryId');
    expect(Y.encodeStateVector(doc)).toEqual(vector);
    await restoreBackup(db, await inspectBackup(await file()));
    expect((await db.captures.get('sample'))?.entryId).toBeUndefined();
    expect(await db.catalog.count()).toBe(1);
    expect((await db.jobs.get('generate:sample'))?.blocked).toBe(true);
  } finally {
    doc.destroy();
    await db.delete();
  }
});

it('merges new records alongside existing pending work without requeueing it', async () => {
  const from = new Database(crypto.randomUUID()),
    to = new Database(crypto.randomUUID());
  const original = globalThis.fetch;
  globalThis.fetch = fakeServices().fetcher as typeof fetch;
  try {
    const local = await capture(to, { ...source, url: 'https://example.org/local' });
    const job = await to.jobs.get(`generate:${local}`);
    await capture(from, source);
    await new Worker(from, async () => settings).run();
    await restoreBackup(to, await inspectBackup(await exportBackup(from)));
    expect(await to.entries.count()).toBe(1);
    expect(await to.captures.count()).toBe(2);
    expect(await to.catalog.count()).toBe(2);
    expect(await to.jobs.toArray()).toEqual([job]);
    expect((await to.catalog.get(`capture:${local}`))?.term).toBe('reluctant');
    expect(await to.syncMeta.get('backup:catalog')).toBeUndefined();
  } finally {
    globalThis.fetch = original;
    await from.delete();
    await to.delete();
  }
});
