import * as Y from 'yjs';
import { z } from 'zod';
import { materialSchema, sourceSchema } from '../domain/model';
import { deleted } from '../domain/sync';
import { shardFor, type PendingChange, type SharedTable } from '../storage/changes';
import { wordlistMode } from '../domain/wordlists';

export class SyncDataError extends Error {}

const id = z.string().min(1).max(300);
const lifecycle = {
  deletions: z.array(id).max(10000).optional(),
  acknowledged: z.array(id).max(10000).optional(),
};
const schemas = {
  wordlists: z.strictObject({
    id,
    name: z.string().min(1).max(120),
    mode: wordlistMode,
    enabled: z.boolean(),
    count: z.int().nonnegative().max(100000),
    createdAt: z.number().nonnegative(),
    ...lifecycle,
  }),
  wordlistContents: z.strictObject({ id, terms: z.array(z.string().min(1).max(150)).max(100000) }),
  captures: z.strictObject({
    id,
    source: sourceSchema,
    createdAt: z.number().nonnegative(),
    entryId: id.optional(),
    ...lifecycle,
  }),
  entries: z.strictObject({
    id,
    language: z.string().max(50),
    lemma: z.string().max(150),
    sense: z.string().max(300),
    generationId: id,
    createdAt: z.number().nonnegative(),
    ...lifecycle,
  }),
  generations: z.strictObject({
    id,
    captureId: id,
    material: materialSchema.refine(
      (m) => m.examples.every((e) => e.text.split(e.target).length === 2 && !/\{\{|\}\}/.test(e.text)),
      'Invalid example target',
    ),
    createdAt: z.number().nonnegative(),
  }),
  vocabulary: z.strictObject({
    id,
    language: z.string().max(50),
    lemma: z.string().max(150),
    forms: z.array(z.string().max(200)).max(10000),
    state: z.enum(['learning', 'known']),
  }),
};
export type SharedRecord = {
  [K in SharedTable]: { table: K; value: z.infer<(typeof schemas)[K]> };
}[SharedTable];
export const maxSnapshotBytes = 32 * 1024 * 1024;
const magic = new Uint8Array([84, 71, 1, 0]);

export function applySnapshot(doc: Y.Doc, bytes: Uint8Array) {
  if (bytes.length > maxSnapshotBytes || !magic.every((n, i) => bytes[i] === n))
    throw new SyncDataError('同步文件无效或版本不兼容');
  try {
    Y.applyUpdate(doc, bytes.subarray(4));
  } catch (cause) {
    throw new SyncDataError('同步文件损坏', { cause });
  }
}
export function snapshot(doc: Y.Doc) {
  const update = Y.encodeStateAsUpdate(doc);
  const bytes = new Uint8Array(update.length + 4);
  bytes.set(magic);
  bytes.set(update, 4);
  if (bytes.length > maxSnapshotBytes) throw new SyncDataError('同步分片过大，未上传');
  return bytes;
}

export function applyChanges(doc: Y.Doc, changes: PendingChange[]) {
  doc.transact(() => {
    for (const change of changes) {
      const map = doc.getMap(change.id);
      for (const [key, value] of Object.entries(change.patch)) {
        if ((key === 'forms' || key === 'deletions') && Array.isArray(value)) {
          for (const item of value) map.set(`${key}:${item}`, true);
        } else if (value === null) map.delete(key);
        else map.set(key, value);
      }
    }
  });
}

export function records(doc: Y.Doc, shard: string): SharedRecord[] {
  if (doc.share.size > 100000) throw new SyncDataError('同步分片包含过多记录');
  const result: SharedRecord[] = [];
  for (const name of doc.share.keys()) {
    const split = name.indexOf(':');
    const table = name.slice(0, split) as SharedTable;
    if (!Object.hasOwn(schemas, table) || shardFor(name) !== shard)
      throw new SyncDataError('同步记录位置无效');
    const map = doc.getMap(name);
    const data: Record<string, unknown> = {};
    const forms: string[] = [],
      deletions: string[] = [];
    for (const [key, value] of map) {
      if (key.startsWith('forms:') && value === true) forms.push(key.slice(6));
      else if (key.startsWith('deletions:') && value === true) deletions.push(key.slice(10));
      else Object.defineProperty(data, key, { value, enumerable: true });
    }
    if (table === 'vocabulary') data.forms = forms.sort();
    if (deletions.length) data.deletions = deletions.sort();
    const parsed = schemas[table].parse(data);
    if (parsed.id !== name.slice(split + 1)) throw new SyncDataError('同步记录身份无效');
    result.push({ table, value: parsed } as SharedRecord);
  }
  return result;
}

export function materialize(row: SharedRecord) {
  return row.table === 'entries' || row.table === 'captures' || row.table === 'wordlists'
    ? { ...row.value, deleted: deleted(row.value) || undefined }
    : row.value;
}
