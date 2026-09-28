import { expect, it, vi } from 'vitest';
import { Database } from '../src/storage/database';
import { syncSettingsSchema } from '../src/domain/sync';
import { SyncService } from '../src/sync/service';
import { startSyncServer } from './sync-servers';

it('saving schedules without network, restart preserves alarms, and disabling clears them', async () => {
  const db = new Database(crypto.randomUUID());
  const config = syncSettingsSchema.parse({ backend: 'webdav', endpoint: 'https://example.org/dav' });
  const schedule = vi.fn(async (_when?: number, _preserve?: boolean) => {});
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const hooks = { schedule, changed: () => {}, recordsChanged: () => {}, jobs: () => {} };
  try {
    const service = new SyncService(db, async () => config, hooks);
    await service.initialize();
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Number), true);
    await service.configure({ ...config, workspace: 'next' });
    expect(fetcher).not.toHaveBeenCalled();
    await db.syncMeta.put({ id: 'paused', value: 'true' });
    await new SyncService(db, async () => config, hooks).initialize();
    expect(schedule).toHaveBeenLastCalledWith(undefined, true);
    await service.configure({ ...config, backend: 'off' });
    expect(schedule).toHaveBeenLastCalledWith(undefined);
  } finally {
    vi.unstubAllGlobals();
    await db.delete();
  }
});

it('leaves a recovery wake before network work and persists an authentication pause', async () => {
  const db = new Database(crypto.randomUUID());
  const server = await startSyncServer('webdav');
  const schedule = vi.fn(async (_when?: number, _preserve?: boolean) => {});
  const service = new SyncService(db, async () => ({ ...server.config, password: 'wrong' }), {
    schedule,
    changed: () => {},
    recordsChanged: () => {},
    jobs: () => {},
  });
  try {
    await service.initialize();
    const started = Date.now();
    const result = await service.run();
    expect(schedule.mock.calls[1]?.[0]).toBeGreaterThanOrEqual(started + 6 * 60000);
    expect(result.error).toContain('同步权限不足');
    expect((await db.syncMeta.get('paused'))?.value).toBe('true');
    expect(schedule).toHaveBeenLastCalledWith(undefined);
  } finally {
    await server.close();
    await db.delete();
  }
});
