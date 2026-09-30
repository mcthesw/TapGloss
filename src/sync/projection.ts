import type { Database } from '../storage/database';
import { queue } from '../storage/database';
import { captureRow, entryRow, rebuildCatalog } from '../storage/catalog';
import type { Capture, Entry } from '../domain/model';
import { materialize, type SharedRecord } from './document';
import { sharedTables } from '../storage/changes';
import { indexWordlist, clearWordlistIndex } from '../storage/wordlists';
import type { Wordlist, WordlistContent } from '../domain/wordlists';

function same(before: Record<string, unknown> | undefined, after: object) {
  if (!before) return false;
  const next = after as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(next)])].every(
    (key) => JSON.stringify(before[key]) === JSON.stringify(next[key]),
  );
}

// The caller owns the transaction. Bulk reads/writes avoid one IndexedDB round trip per record.
export async function project(
  db: Database,
  rows: SharedRecord[],
  mode: 'sync' | 'restore' | 'initialRestore' = 'sync',
) {
  const initial = mode === 'initialRestore';
  const affected = new Set<string>();
  for (const name of sharedTables) {
    const selected = rows.filter((r) => r.table === name);
    const previous = initial ? [] : await db.table(name).bulkGet(selected.map((r) => r.value.id));
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
    if (name === 'wordlists')
      for (const list of values as Wordlist[]) {
        if (list.deleted) await clearWordlistIndex(db, list.id);
      }
    if (name === 'wordlistContents')
      for (const content of values as WordlistContent[]) {
        if (!(await db.wordlists.get(content.id))?.deleted)
          await indexWordlist(db, content.id, content.terms);
      }
    if (name === 'entries') for (const e of values) affected.add(e.id);
    if (name === 'captures') {
      const captures = values as Capture[];
      const pending = captures.filter((c) => !c.deleted && !c.entryId);
      if (mode === 'sync') await db.catalog.bulkPut(pending.map(captureRow));
      const resolved = captures.filter((c) => c.deleted || c.entryId);
      if (mode === 'sync') {
        await db.catalog.bulkDelete(resolved.map((c) => `capture:${c.id}`));
        await db.jobs.bulkDelete(resolved.map((c) => `generate:${c.id}`));
      }
      for (const c of captures) if (c.entryId) affected.add(c.entryId);
    }
    if (name === 'generations' && mode === 'sync') {
      const entries = (
        await Promise.all(values.map((g) => db.entries.where('generationId').equals(g.id).toArray()))
      ).flat();
      for (const e of entries) affected.add(e.id);
    }
  }
  if (mode !== 'sync') {
    // Restore repairs the complete local index once, including merges into existing data.
    await db.syncMeta.put({ id: 'backup:catalog', value: 'rebuild' });
    return;
  }
  await db.syncMeta.bulkPut([...affected].map((id) => ({ id: `repair:${id}`, value: '' })));
}

export async function repairCatalog(db: Database) {
  await db.transaction('rw', db.tables, async () => {
    if (!(await db.syncMeta.get('backup:catalog'))) return;
    await rebuildCatalog(db);
    await db.syncMeta.delete('backup:catalog');
  });
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
          batch[i]?.value !== 'backup' &&
          (!job || (!job.blocked && job.leaseUntil > Date.now()))
        )
          await queue(db, 'export', e.id);
      }
      await db.syncMeta.bulkDelete(batch.map((r) => r.id));
    });
  }
}
