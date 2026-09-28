import type { Material } from '../domain/model';
import { validateMaterial } from '../domain/model';
import { Database, queue } from './database';
import { updateCatalog } from './catalog';
import { track } from './changes';
import { deletion } from '../domain/sync';

export async function removeSource(db: Database, id: string) {
  await db.transaction(
    'rw',
    [db.captures, db.entries, db.generations, db.catalog, db.jobs, db.syncChanges],
    async (tx) => {
      const c = await db.captures.get(id);
      if (!c) return;
      const next = { ...c, ...deletion(c) };
      await db.captures.put(next);
      await track(tx, 'captures', c, next);
      await db.jobs.delete(`generate:${id}`);
      await db.catalog.delete(`capture:${id}`);
      if (c?.entryId) {
        await updateCatalog(db, c.entryId);
        await queue(db, 'export', c.entryId);
      }
    },
  );
}
export async function editMaterial(db: Database, entryId: string, value: Material) {
  await db.transaction(
    'rw',
    [db.entries, db.generations, db.captures, db.catalog, db.jobs, db.syncChanges],
    async (tx) => {
      const entry = await db.entries.get(entryId);
      if (!entry || entry.deleted) throw new Error('该条目已删除');
      const old = await db.generations.get(entry.generationId);
      const c = old && (await db.captures.get(old.captureId));
      if (!c || !old) throw new Error('未找到原始语境');
      const material = validateMaterial(value, c.source);
      if (material.language !== old.material.language || material.lemma !== old.material.lemma)
        throw new Error('编辑仅用于纠正释义与例句');
      const id = crypto.randomUUID();
      const generation = { id, captureId: c.id, material, createdAt: Date.now() };
      await db.generations.add(generation);
      const next = { ...entry, generationId: id };
      await db.entries.put(next);
      await track(tx, 'generations', undefined, generation);
      await track(tx, 'entries', entry, next);
      await updateCatalog(db, entryId);
      await queue(db, 'export', entryId);
    },
  );
}
