import * as Y from 'yjs';
import { Database } from '../storage/database';
import { project, repairCatalog } from './projection';
import { applyChanges, applySnapshot, records, snapshot } from './document';
import { filePattern, type RemoteStore, type RemoteFile } from './transport';

export class SyncEngine {
  private running?: Promise<void>;
  constructor(
    private db: Database,
    private changed: () => void = () => {},
  ) {}
  run(remote: RemoteStore, target: string, signal?: AbortSignal) {
    return (this.running ??= this.exchange(remote, target, signal).finally(() => {
      this.running = undefined;
    }));
  }
  private async exchange(remote: RemoteStore, target: string, signal?: AbortSignal) {
    const db = this.db;
    const device = await db.transaction('rw', [db.syncMeta, db.syncShards], async () => {
      let device = (await db.syncMeta.get('device'))?.value;
      if (!device) {
        device = crypto.randomUUID();
        await db.syncMeta.put({ id: 'device', value: device });
      }
      if ((await db.syncMeta.get('target'))?.value !== target) {
        await db.syncMeta.where('id').startsWith('remote:').delete();
        await db.syncShards.toCollection().modify({ upload: 1 });
        await db.syncMeta.put({ id: 'target', value: target });
      }
      return device;
    });
    const files = await remote.list(signal);
    const seen = new Map(
      (await db.syncMeta.where('id').startsWith('remote:').toArray()).map((r) => [r.id.slice(7), r.value]),
    );
    const incoming = files.filter((f) => !f.revision || seen.get(f.key) !== f.revision);
    const shards = new Set([
      ...((await db.syncChanges.orderBy('shard').uniqueKeys()) as string[]),
      ...((await db.syncShards.where('upload').equals(1).primaryKeys()) as string[]),
      ...incoming.map((f) => filePattern.exec(f.key)![1]!),
    ]);
    try {
      for (const shard of [...shards].sort()) {
        signal?.throwIfAborted();
        const downloads: (RemoteFile & { bytes: Uint8Array })[] = [];
        for (const file of incoming.filter((f) => f.key.startsWith(shard + '-')))
          downloads.push({ ...file, bytes: await remote.get(file.key, signal) });
        const state = await db.transaction('rw', db.tables, async () => {
          const previous = await db.syncShards.get(shard);
          const changes = await db.syncChanges.where('shard').equals(shard).toArray();
          const doc = new Y.Doc();
          try {
            if (previous) applySnapshot(doc, previous.bytes);
            // Local edits were made against the previous replica, not against unseen remote edits.
            applyChanges(doc, changes);
            for (const download of downloads) applySnapshot(doc, download.bytes);
            await project(db, records(doc, shard));
            const next = {
              id: shard,
              bytes: snapshot(doc),
              upload: previous?.upload || changes.length > 0 ? 1 : 0,
            };
            await db.syncShards.put(next);
            await db.syncChanges.bulkDelete(changes.map((c) => c.id));
            for (const file of downloads)
              if (file.revision) await db.syncMeta.put({ id: `remote:${file.key}`, value: file.revision });
            return next;
          } finally {
            doc.destroy();
          }
        });
        if (state.upload) {
          await remote.put(`${shard}-${device}.bin`, state.bytes, signal);
          await db.syncShards.update(shard, { upload: 0 });
        }
      }
    } finally {
      // Durable repair markers survive termination between a shard commit and its read-model refresh.
      await this.repair();
      this.changed();
    }
  }
  repair() {
    return repairCatalog(this.db);
  }
}
