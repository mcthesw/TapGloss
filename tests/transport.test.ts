import { expect, it } from 'vitest';
import { createRemote } from '../src/sync/transport';
import { testRemote } from '../src/sync/service';
import { startSyncServer } from './sync-servers';

it.each(['s3', 'webdav'] as const)(
  'round-trips binary snapshots through an authenticated %s HTTP server',
  async (backend) => {
    const server = await startSyncServer(backend);
    const remote = createRemote(server.config);
    try {
      await testRemote(server.config);
      expect(await remote.list()).toEqual([]);
      const key = `00-${crypto.randomUUID()}.bin`;
      const bytes = new Uint8Array([84, 71, 1, 0, 255, 128, 0, 3]);
      await remote.put(key, bytes);
      expect((await remote.list()).map((f) => f.key)).toEqual([key]);
      expect(await remote.get(key)).toEqual(bytes);
      await remote.put(key, new Uint8Array([1, 2]));
      expect(await remote.get(key)).toEqual(new Uint8Array([1, 2]));
      const other = createRemote({ ...server.config, workspace: 'another' });
      try {
        expect(await other.list()).toEqual([]);
      } finally {
        other.close?.();
      }
      await expect(testRemote({ ...server.config, username: 'wrong', password: 'wrong' })).rejects.toThrow();
    } finally {
      remote.close?.();
      await server.close();
    }
  },
);
