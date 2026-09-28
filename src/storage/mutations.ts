import type { Material } from '../domain/model';
import { validateMaterial } from '../domain/model';
import { Database, queue } from './database';
import { updateCatalog } from './catalog';

export async function removeSource(db: Database, id: string) {
  await db.transaction('rw', [db.captures, db.entries, db.generations, db.catalog, db.jobs], async () => {
    const c = await db.captures.get(id);
    await db.captures.update(id, { deleted: true });
    await db.jobs.delete(`generate:${id}`);
    await db.catalog.delete(`capture:${id}`);
    if (c?.entryId) {
      await updateCatalog(db, c.entryId);
      await queue(db, 'export', c.entryId);
    }
  });
}
export async function editMaterial(db: Database, entryId: string, value: Material) {
  await db.transaction('rw', [db.entries, db.generations, db.captures, db.catalog, db.jobs], async () => {
    const entry = await db.entries.get(entryId);
    if (!entry || entry.deleted) throw new Error('该条目已删除');
    const old = await db.generations.get(entry.generationId);
    const c = old && (await db.captures.get(old.captureId));
    if (!c || !old) throw new Error('未找到原始语境');
    const material = validateMaterial(value, c.source);
    if (material.language !== old.material.language || material.lemma !== old.material.lemma)
      throw new Error('编辑仅用于纠正释义与例句');
    const id = crypto.randomUUID();
    await db.generations.add({ id, captureId: c.id, material, createdAt: Date.now() });
    await db.entries.update(entryId, { generationId: id });
    await updateCatalog(db, entryId);
    await queue(db, 'export', entryId);
  });
}
