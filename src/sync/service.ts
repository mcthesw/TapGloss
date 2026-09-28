import type { SyncSettings, SyncStatus } from '../domain/sync';
import type { Database } from '../storage/database';
import { SyncEngine } from './engine';
import { createRemote, type RemoteStore } from './transport';
import { SyncDataError } from './document';

const interval = 5 * 60000;
function failure(error: unknown) {
  const e = error as {
    status?: number;
    statusCode?: number;
    $metadata?: { httpStatusCode?: number };
    name?: string;
  };
  const code = e?.status ?? e?.statusCode ?? e?.$metadata?.httpStatusCode;
  if (code === 401 || code === 403) return { message: '同步权限不足，请检查凭据与目录权限', retry: false };
  if (code && code >= 400 && code < 500 && code !== 408 && code !== 429)
    return { message: `同步服务返回 ${code}，请检查地址与存储配置`, retry: false };
  if (e?.name === 'ZodError' || error instanceof SyncDataError)
    return { message: '远程数据不符合格式，未应用该分片', retry: false };
  return { message: '同步未完成，本地数据已保留；请检查连接或重试', retry: true };
}
function timed(remote: RemoteStore, signal: AbortSignal): RemoteStore {
  const timeout = () => AbortSignal.any([signal, AbortSignal.timeout(25000)]);
  return {
    list: () => remote.list(timeout()),
    get: (key) => remote.get(key, timeout()),
    put: (key, data) => remote.put(key, data, timeout()),
  };
}
export async function testRemote(config: SyncSettings, signal?: AbortSignal) {
  const remote = createRemote(config);
  try {
    await remote.list(AbortSignal.any([AbortSignal.timeout(25000), ...(signal ? [signal] : [])]));
  } catch (e) {
    throw new Error(failure(e).message, { cause: e });
  } finally {
    remote.close?.();
  }
}

export class SyncService {
  private current: SyncStatus = { running: false };
  private running?: Promise<SyncStatus>;
  private controller?: AbortController;
  private connection = '';
  private failures = 0;
  private engine: SyncEngine;
  constructor(
    private db: Database,
    private settings: () => Promise<SyncSettings>,
    private hooks: {
      changed: () => void;
      recordsChanged: () => void;
      jobs: () => void;
      schedule: (when?: number, preserve?: boolean) => Promise<void>;
    },
  ) {
    this.engine = new SyncEngine(db, hooks.recordsChanged);
  }
  async status(): Promise<SyncStatus> {
    const last = await this.db.syncMeta.get('lastSuccess');
    const error = await this.db.syncMeta.get('lastError');
    return {
      ...this.current,
      lastSuccess: last ? Number(last.value) : undefined,
      error: error?.value || undefined,
    };
  }
  async configure(config: SyncSettings) {
    const connection = JSON.stringify(config);
    if (this.connection === connection) return;
    this.connection = connection;
    this.controller?.abort();
    this.failures = 0;
    await this.db.syncMeta.delete('paused');
    await this.hooks.schedule(config.backend === 'off' ? undefined : Date.now() + interval);
  }
  async initialize() {
    await this.engine.repair();
    const config = await this.settings();
    this.connection = JSON.stringify(config);
    const paused = await this.db.syncMeta.get('paused');
    await this.hooks.schedule(config.backend === 'off' || paused ? undefined : Date.now() + interval, true);
  }
  run() {
    if (this.running) {
      void this.hooks.schedule(Date.now() + interval + 60000);
      return this.running;
    }
    return (this.running ??= this.perform().finally(() => {
      this.running = undefined;
    }));
  }
  private async perform() {
    const config = await this.settings();
    if (config.backend === 'off') throw new Error('请先配置并保存同步设置');
    const connection = this.connection;
    const controller = new AbortController();
    this.controller = controller;
    this.current = { running: true };
    // A large first sync may outlive an MV3 event. Leave a durable wake-up before starting I/O.
    await this.hooks.schedule(Date.now() + interval + 60000);
    await this.db.syncMeta.delete('lastError');
    this.hooks.changed();
    const remote = createRemote(config);
    try {
      const target = JSON.stringify([
        config.backend,
        new URL(config.endpoint).href,
        config.bucket,
        config.workspace,
      ]);
      await this.engine.run(timed(remote, controller.signal), target, controller.signal);
      await this.db.syncMeta.put({ id: 'lastSuccess', value: String(Date.now()) });
      await this.db.syncMeta.delete('paused');
      this.failures = 0;
      if (connection === this.connection) await this.hooks.schedule(Date.now() + interval);
    } catch (error) {
      if (!controller.signal.aborted) {
        const result = failure(error);
        await this.db.syncMeta.put({ id: 'lastError', value: result.message });
        if (!result.retry) await this.db.syncMeta.put({ id: 'paused', value: 'true' });
        if (connection === this.connection)
          await this.hooks.schedule(
            result.retry ? Date.now() + Math.min(3600000, interval * 2 ** this.failures++) : undefined,
          );
      }
    } finally {
      remote.close?.();
      this.controller = undefined;
      this.current = { running: false };
      this.hooks.changed();
      this.hooks.jobs();
    }
    return this.status();
  }
}
