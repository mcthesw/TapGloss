import type { Database } from '../storage/database';
import { queue } from '../storage/database';
import { captureRow, entryRow } from '../storage/catalog';
import type { Capture, Entry } from '../domain/model';
import { materialize, type SharedRecord } from './document';
import { sharedTables } from '../storage/changes';

function same(before: Record<string, unknown> | undefined, after: object) {
  if (!before) return false;
  const next = after as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(next)])].every(
    (key) => JSON.stringify(before[key]) === JSON.stringify(next[key]),
  );
}

// The caller owns the transaction. Bulk reads/writes avoid one IndexedDB round trip per record.
export async function project(db: Database, rows: SharedRecord[]) {
  const affected = new Set<string>();
  for (const name of sharedTables) {
    const selected = rows.filter((r) => r.table === name);
    const previous = await db.table(name).bulkGet(selected.map((r) => r.value.id));
    const values = selected.flatMap((row, i) => {
      const value = materialize(row),
        old = previous[i];
      if (name === 'captures' && old?.restoreDeletions)
        Object.assign(value, { restoreDeletions: old.restoreDeletions });
      if (name === 'entries' && (value as Entry).deleted) {
        const unseen = (value as Entry).deletions?.some((t) => !old?.deletions?.includes(t));
        Object.assign(value, { deletedAt: unseen ? Date.now() : (old?.deletedAt ?? Date.now()) });
      }
      if (same(old, value)) return [];
      if (name === 'captures' && old?.entryId) affected.add(old.entryId);
      return [value];
    });
    if (!values.length) continue;
    await db.table(name).bulkPut(values);
    if (name === 'entries') for (const e of values) affected.add(e.id);
    if (name === 'captures') {
      const captures = values as Capture[];
      const pending = captures.filter((c) => !c.deleted && !c.entryId);
      await db.catalog.bulkPut(pending.map(captureRow));
      const resolved = captures.filter((c) => c.deleted || c.entryId);
      await db.catalog.bulkDelete(resolved.map((c) => `capture:${c.id}`));
      await db.jobs.bulkDelete(resolved.map((c) => `generate:${c.id}`));
      for (const c of captures) if (c.entryId) affected.add(c.entryId);
    }
    if (name === 'generations') {
      const entries = (
        await Promise.all(values.map((g) => db.entries.where('generationId').equals(g.id).toArray()))
      ).flat();
      for (const e of entries) affected.add(e.id);
    }
  }
  await db.syncMeta.bulkPut([...affected].map((id) => ({ id: `repair:${id}`, value: '' })));
}

export async function repairCatalog(db: Database) {
  while (true) {
    const batch = await db.syncMeta.where('id').startsWith('repair:').limit(250).toArray();
    if (!batch.length) return;
    await db.transaction('rw', db.tables, async () => {
      const ids = batch.map((row) => row.id.slice(7));
      const entries = await db.entries.bulkGet(ids);
      const [generations, sources, bindings, jobs] = await Promise.all([
        db.generations.bulkGet(entries.map((e) => e?.generationId ?? '')),
        Promise.all(ids.map((id) => db.captures.where('entryId').equals(id).toArray())).then((groups) =>
          groups.flat().filter((c) => !c.deleted),
        ),
        db.ankiBindings.bulkGet(ids),
        db.jobs.bulkGet(ids.map((id) => `export:${id}`)),
      ]);
      const grouped = new Map<string, Capture[]>();
      for (const c of sources) {
        if (!grouped.has(c.entryId!)) grouped.set(c.entryId!, []);
        grouped.get(c.entryId!)!.push(c);
      }
      await db.catalog.bulkDelete(
        ids
          .filter((_, i) => !entries[i] || entries[i]!.deleted || !generations[i])
          .map((id) => `entry:${id}`),
      );
      await db.jobs.bulkDelete(ids.filter((_, i) => entries[i]?.deleted).map((id) => `export:${id}`));
      await db.catalog.bulkPut(
        entries.flatMap((e, i) =>
          e && !e.deleted && generations[i] ? [entryRow(e, generations[i]!, grouped.get(e.id) ?? [])] : [],
        ),
      );
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i],
          job = jobs[i];
        if (
          e &&
          !e.deleted &&
          generations[i] &&
          bindings[i] &&
          (!job || (!job.blocked && job.leaseUntil > Date.now()))
        )
          await queue(db, 'export', e.id);
      }
      await db.syncMeta.bulkDelete(batch.map((r) => r.id));
    });
  }
}
