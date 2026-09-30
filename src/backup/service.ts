import * as Y from 'yjs';
import { Database, queue } from '../storage/database';
import { applyChanges, applySnapshot, records, snapshot } from '../sync/document';
import { project, repairCatalog } from '../sync/projection';
import { sharedTables } from '../storage/changes';
import { backupShards, openBackup, packBackup, type BackupFile } from './file';

type Progress = (fraction: number) => void;
const noProgress: Progress = () => {};
function equalBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

// Persist causal history locally before saving it, even when remote sync is off.
export async function exportBackup(db: Database, progress: Progress = noProgress) {
  progress(0);
  const state = await db.transaction('rw', db.tables, async () => {
    const ids = new Set([
      ...(await db.syncShards.toCollection().primaryKeys()),
      ...(await db.syncChanges.orderBy('shard').uniqueKeys()),
    ] as string[]);
    const shards: { id: string; bytes: Uint8Array }[] = [];
    for (const id of [...ids].sort()) {
      const doc = new Y.Doc();
      try {
        const old = await db.syncShards.get(id);
        const changes = await db.syncChanges.where('shard').equals(id).toArray();
        if (old && !changes.length) {
          shards.push({ id, bytes: old.bytes });
          continue;
        }
        if (old) applySnapshot(doc, old.bytes);
        applyChanges(doc, changes);
        records(doc, id);
        const bytes = snapshot(doc);
        await db.syncShards.put({ id, bytes, upload: old?.upload || changes.length ? 1 : 0 });
        shards.push({ id, bytes });
      } finally {
        doc.destroy();
        progress((shards.length / Math.max(ids.size, 1)) * 0.9);
      }
    }
    // This transaction holds every shared table: all outbox rows have been folded above.
    await db.syncChanges.clear();
    return {
      shards,
      metadata: {
        createdAt: Date.now(),
        records: await db.catalog.count(),
        wordlists: await db.wordlists.filter((w) => !w.deleted).count(),
        bindings: await db.ankiBindings.toArray(),
      },
    };
  });
  const file = await packBackup(state.metadata, state.shards);
  progress(1);
  return file;
}

export async function inspectBackup(file: Blob, progress: Progress = noProgress) {
  progress(0);
  try {
    const backup = await openBackup(file);
    let completed = 0;
    // Validate every shard before the first write; corrupted files cannot partly restore.
    for await (const shard of backupShards(backup)) {
      const doc = new Y.Doc();
      try {
        applySnapshot(doc, shard.bytes);
        records(doc, shard.id);
      } finally {
        doc.destroy();
      }
      progress(++completed / Math.max(backup.header.shards.length, 1));
    }
    progress(1);
    return backup;
  } catch {
    throw new Error('备份文件无效、损坏或版本不兼容');
  }
}
export async function restoreBackup(db: Database, backup: BackupFile, progress: Progress = noProgress) {
  // Revalidate when called independently of the preview UI.
  backup = await inspectBackup(backup.file, (fraction) => progress(fraction * 0.2));
  const empty = (await Promise.all(sharedTables.map((name) => db.table(name).count()))).every((n) => n === 0);
  let completed = 0;
  for await (const shard of backupShards(backup)) {
    await db.transaction('rw', db.tables, async () => {
      const doc = new Y.Doc();
      try {
        const old = await db.syncShards.get(shard.id);
        const changes = await db.syncChanges.where('shard').equals(shard.id).toArray();
        if (old && !changes.length && equalBytes(old.bytes, shard.bytes)) return;
        if (old) applySnapshot(doc, old.bytes);
        applyChanges(doc, changes);
        const before = snapshot(doc);
        applySnapshot(doc, shard.bytes);
        const bytes = snapshot(doc);
        // Compare the full update, including deletion sets, rather than just its state vector.
        const changed = !equalBytes(before, bytes);
        if (changed)
          await project(
            db,
            records(doc, shard.id),
            empty && !old && !changes.length ? 'initialRestore' : 'restore',
          );
        if (changed || changes.length) {
          await db.syncShards.put({ id: shard.id, bytes, upload: 1 });
          await db.syncChanges.where('shard').equals(shard.id).delete();
        }
      } finally {
        doc.destroy();
      }
    });
    progress(0.2 + (++completed / Math.max(backup.header.shards.length, 1)) * 0.65);
  }
  await repairCatalog(db);
  progress(0.9);
  await db.transaction('rw', db.tables, async () => {
    const bindings = backup.header.bindings;
    const existing = new Map((await db.ankiBindings.toArray()).map((b) => [b.id, b]));
    const entries = new Map((await db.entries.toArray()).map((e) => [e.id, e]));
    await db.ankiBindings.bulkPut(bindings.filter((b) => !existing.has(b.id) && entries.has(b.id)));
    const pendingRows = await db.catalog.where('id').startsWith('capture:').toArray();
    const pending = await db.captures.bulkGet(pendingRows.map((row) => row.captureId));
    for (const capture of pending) {
      if (!capture || capture.deleted || capture.entryId) continue;
      const id = `generate:${capture.id}`;
      if (!(await db.jobs.get(id))) {
        await queue(db, 'generate', capture.id);
        await db.jobs.update(id, { blocked: true, error: '从备份恢复，请手动重试' });
      }
    }
    for (const b of bindings) {
      const e = entries.get(b.id);
      if (!e || e.deleted || b.noteId || existing.has(b.id) || (await db.jobs.get(`export:${e.id}`)))
        continue;
      await queue(db, 'export', e.id);
      await db.jobs.update(`export:${e.id}`, { blocked: true, error: '从备份恢复，请手动重试' });
    }
  });
  progress(1);
}
