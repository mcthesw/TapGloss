import type { Transaction } from 'dexie';

const readingTables = ['captures', 'entries', 'generations', 'vocabulary'] as const;
export const sharedTables = [...readingTables, 'wordlists', 'wordlistContents'] as const;
export type SharedTable = (typeof sharedTables)[number];
export type PendingChange = {
  id: string;
  shard: string;
  table: SharedTable;
  key: string;
  patch: Record<string, unknown>;
};
export type SyncShard = { id: string; bytes: Uint8Array; upload: number };
export type SyncMeta = { id: string; value: string };

export function shardFor(key: string) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 64).toString(16).padStart(2, '0');
}

function fieldsChanged(before: object | undefined, after: object) {
  const old = (before ?? {}) as Record<string, unknown>;
  const next = after as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (
      [
        'noteId',
        'syncedHash',
        'pendingHash',
        'deleted',
        'restoreToken',
        'restoreDeletions',
        'deleteToken',
        'deletedAt',
      ].includes(key)
    )
      continue;
    if (JSON.stringify(old[key]) !== JSON.stringify(next[key])) patch[key] = next[key] ?? null;
  }
  return patch;
}

// Called inside the same transaction as the domain write. No write can be acknowledged before its outbox.
export async function track(
  tx: Transaction,
  table: SharedTable,
  before: object | undefined,
  after: { id: string },
) {
  const patch = fieldsChanged(before, after);
  if (!Object.keys(patch).length) return;
  const id = `${table}:${after.id}`;
  const outbox = tx.table<PendingChange>('syncChanges');
  const previous = await outbox.get(id);
  await outbox.put({
    id,
    table,
    key: after.id,
    shard: shardFor(id),
    patch: { ...previous?.patch, ...patch },
  });
}

export async function upgradeSync(tx: Transaction) {
  for (const table of readingTables) {
    let last = '';
    while (true) {
      const rows = await tx.table(table).where('id').above(last).limit(250).toArray();
      if (!rows.length) break;
      const bindings = [];
      for (const row of rows) {
        if (table === 'entries') {
          const { id, noteId, syncedHash, pendingHash } = row;
          bindings.push({ id, noteId, syncedHash, pendingHash });
          delete row.noteId;
          delete row.syncedHash;
          delete row.pendingHash;
        }
        if (row.deleted) row.deletions = [row.deleteToken ?? `legacy:${row.id}`];
        delete row.deleteToken;
        delete row.restoreToken;
      }
      if (bindings.length) await tx.table('ankiBindings').bulkPut(bindings);
      if (table === 'entries' || table === 'captures') await tx.table(table).bulkPut(rows);
      await tx.table<PendingChange>('syncChanges').bulkPut(
        rows.map((row) => {
          const id = `${table}:${row.id}`;
          return { id, table, key: row.id, shard: shardFor(id), patch: fieldsChanged(undefined, row) };
        }),
      );
      last = rows.at(-1)!.id;
    }
  }
}
