import { z } from 'zod';
import { maxSnapshotBytes } from '../sync/document';

const magic = new Uint8Array([84, 65, 80, 71, 76, 79, 83, 83, 1]);
const prefixSize = magic.length + 4 + 32;
const maxHeaderBytes = 32 * 1024 * 1024;
const binding = z.strictObject({
  id: z.string().min(1).max(300),
  noteId: z.int().positive().optional(),
  syncedHash: z.string().max(100).optional(),
  pendingHash: z.string().max(100).optional(),
  clozeFirstLetter: z.boolean().optional(),
});
const headerSchema = z.strictObject({
  app: z.literal('TapGloss'),
  version: z.literal(1),
  createdAt: z.number().nonnegative(),
  records: z.int().nonnegative(),
  wordlists: z.int().nonnegative(),
  bindings: z.array(binding).max(1000000),
  shards: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[0-3][0-9a-f]$/),
        size: z.int().positive().max(maxSnapshotBytes),
        hash: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .max(64),
});
export type BackupHeader = z.infer<typeof headerSchema>;
export type BackupFile = { file: Blob; header: BackupHeader; offset: number };
export async function checksum(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
export async function packBackup(
  metadata: Omit<BackupHeader, 'app' | 'version' | 'shards'>,
  shards: { id: string; bytes: Uint8Array }[],
) {
  const header = headerSchema.parse({
    ...metadata,
    app: 'TapGloss',
    version: 1,
    shards: await Promise.all(
      shards.map(async (s) => ({ id: s.id, size: s.bytes.length, hash: await checksum(s.bytes) })),
    ),
  });
  const json = new TextEncoder().encode(JSON.stringify(header));
  if (json.length > maxHeaderBytes) throw new Error('备份元数据过大');
  const prefix = new Uint8Array(prefixSize);
  prefix.set(magic);
  new DataView(prefix.buffer).setUint32(magic.length, json.length);
  prefix.set(
    new Uint8Array((await checksum(json)).match(/../g)!.map((hex) => parseInt(hex, 16))),
    magic.length + 4,
  );
  return new Blob([prefix, json, ...shards.map((s) => s.bytes.slice().buffer)], {
    type: 'application/octet-stream',
  });
}
export async function openBackup(file: Blob): Promise<BackupFile> {
  try {
    const prefix = new Uint8Array(await file.slice(0, prefixSize).arrayBuffer());
    if (prefix.length !== prefixSize || !magic.every((v, i) => prefix[i] === v)) throw new Error();
    const length = new DataView(prefix.buffer).getUint32(magic.length);
    if (length > maxHeaderBytes || length + prefixSize > file.size) throw new Error();
    const json = new Uint8Array(await file.slice(prefixSize, prefixSize + length).arrayBuffer());
    const headerHash = Array.from(prefix.subarray(magic.length + 4), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    if ((await checksum(json)) !== headerHash) throw new Error();
    const header = headerSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)));
    const offset = prefixSize + length;
    if (
      new Set(header.shards.map((s) => s.id)).size !== header.shards.length ||
      offset + header.shards.reduce((sum, s) => sum + s.size, 0) !== file.size ||
      new Set(header.bindings.map((b) => b.id)).size !== header.bindings.length
    )
      throw new Error();
    return { file, header, offset };
  } catch {
    throw new Error('备份文件无效、损坏或版本不兼容');
  }
}
export async function* backupShards(backup: BackupFile) {
  let offset = backup.offset;
  for (const shard of backup.header.shards) {
    const bytes = new Uint8Array(await backup.file.slice(offset, offset + shard.size).arrayBuffer());
    if ((await checksum(bytes)) !== shard.hash) throw new Error('备份文件无效、损坏或版本不兼容');
    offset += shard.size;
    yield { id: shard.id, bytes };
  }
}
