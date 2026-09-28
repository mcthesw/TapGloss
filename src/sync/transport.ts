import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient, type FileStat } from 'webdav';
import type { SyncSettings } from '../domain/sync';
import { maxSnapshotBytes } from './document';

export type RemoteFile = { key: string; revision?: string };
export interface RemoteStore {
  list(signal?: AbortSignal): Promise<RemoteFile[]>;
  get(key: string, signal?: AbortSignal): Promise<Uint8Array>;
  put(key: string, data: Uint8Array, signal?: AbortSignal): Promise<void>;
  close?(): void;
}
export const filePattern = /^([0-3][0-9a-f])-([0-9a-f-]{36})\.bin$/;
function validKey(key: string) {
  if (!filePattern.test(key)) throw new Error('无效同步文件名');
  return key;
}
function bounded(bytes: Uint8Array) {
  if (bytes.length > maxSnapshotBytes) throw new Error('同步文件过大');
  return bytes;
}
export function createRemote(config: SyncSettings): RemoteStore {
  const prefix = `TapGloss/v1/${config.workspace}/`;
  if (config.backend === 's3') {
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.username, secretAccessKey: config.password },
      maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return {
      async list(signal) {
        const result: RemoteFile[] = [];
        let token: string | undefined;
        do {
          const page = await client.send(
            new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: token }),
            { abortSignal: signal },
          );
          for (const file of page.Contents ?? []) {
            const key = file.Key?.slice(prefix.length);
            if (key && filePattern.test(key)) {
              if ((file.Size ?? 0) > maxSnapshotBytes) throw new Error('同步文件过大');
              result.push({ key, revision: file.ETag });
            }
          }
          token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
        return result;
      },
      async get(key, signal) {
        const file = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: prefix + validKey(key) }),
          { abortSignal: signal },
        );
        if (!file.Body || (file.ContentLength ?? 0) > maxSnapshotBytes) throw new Error('同步文件无效或过大');
        return bounded(await file.Body.transformToByteArray());
      },
      async put(key, data, signal) {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: prefix + validKey(key),
            Body: bounded(data),
            ContentType: 'application/octet-stream',
          }),
          { abortSignal: signal },
        );
      },
      close: () => client.destroy(),
    };
  }
  if (config.backend !== 'webdav') throw new Error('请先配置同步');
  const client = createClient(config.endpoint, { username: config.username, password: config.password });
  const path = '/' + prefix.slice(0, -1);
  let ready = false;
  return {
    async list(signal) {
      if (!(await client.exists(path, { signal }))) {
        await client.getDirectoryContents('/', { signal });
        return [];
      }
      const files = (await client.getDirectoryContents(path, { signal })) as FileStat[];
      return files
        .filter((f) => f.type === 'file' && filePattern.test(f.basename))
        .map((f) => {
          if (f.size > maxSnapshotBytes) throw new Error('同步文件过大');
          return { key: f.basename, revision: f.etag || undefined };
        });
    },
    async get(key, signal) {
      return bounded(
        new Uint8Array(
          (await client.getFileContents(`${path}/${validKey(key)}`, {
            format: 'binary',
            signal,
          })) as ArrayBuffer,
        ),
      );
    },
    async put(key, data, signal) {
      if (!ready) {
        await client.createDirectory(path, { recursive: true, signal });
        ready = true;
      }
      await client.putFileContents(`${path}/${validKey(key)}`, new Uint8Array(bounded(data)).buffer, {
        overwrite: true,
        contentLength: false,
        signal,
      });
    },
  };
}
