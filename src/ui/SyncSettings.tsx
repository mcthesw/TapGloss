import { useEffect, useRef, useState } from 'preact/hooks';
import { send, subscribeChanges } from '../messages';
import type { SyncSettings as Configuration, SyncStatus } from '../domain/sync';
import { Help } from './Help';
import { Select } from './Select';

export function SyncSettings({
  value,
  saved,
  change,
  active,
}: {
  value: Configuration;
  saved: Configuration;
  change: (value: Configuration) => void;
  active: boolean;
}) {
  const [status, setStatus] = useState<SyncStatus>({ running: false });
  const [testing, setTesting] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(false);
  const request = useRef<AbortController>();
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const patch = (next: Partial<Configuration>) => change({ ...value, ...next });
  useEffect(() => {
    request.current?.abort();
    setTesting(false);
    setNotice('');
    return () => request.current?.abort();
  }, [JSON.stringify(value), active]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const refresh = () => {
      void send({ type: 'syncStatus' })
        .then((s) => {
          if (!disposed) setStatus(s);
        })
        .catch(() => {});
    };
    const unsubscribe = subscribeChanges((c) => {
      if (c.initial || c.sync) refresh();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [active]);
  return (
    <section class="paper space-y-5">
      <div class="settings-heading">
        <h2>{'同步'}</h2>
        <Help label={'同步帮助'}>
          {
            '在各设备填写同一工作区，阅读记录与词汇状态会自动合并。启用后每五分钟同步，离线时继续保存本地。 密钥、连接设置和本机 Anki 任务不参与同步；收到的记录不会重复制卡。远程数据未加密，请使用自己的私有存储。 测试连接只检查读取权限；保存后可立即同步。'
          }{' '}
        </Help>
      </div>
      <Select
        label={'存储方式'}
        value={value.backend}
        options={[
          { value: 'off', label: '停用同步' },
          { value: 's3', label: 'S3' },
          { value: 'webdav', label: 'WebDAV' },
        ]}
        change={(backend) => patch({ backend: backend as Configuration['backend'] })}
      />
      {value.backend !== 'off' && (
        <>
          <label>
            {value.backend === 's3' ? 'S3 地址' : 'WebDAV 地址'}
            <input
              type="url"
              required
              value={value.endpoint}
              onInput={(e) => patch({ endpoint: e.currentTarget.value })}
            />
          </label>
          {value.backend === 's3' && (
            <div class="sync-fields">
              <label>
                {'存储桶'}{' '}
                <input
                  required
                  value={value.bucket}
                  onInput={(e) => patch({ bucket: e.currentTarget.value })}
                />
              </label>
              <label>
                {'区域'}{' '}
                <input
                  required
                  value={value.region}
                  onInput={(e) => patch({ region: e.currentTarget.value })}
                />
              </label>
            </div>
          )}
          <label>
            {value.backend === 's3' ? 'Access Key ID' : '用户名'}
            <input
              autoComplete="off"
              value={value.username}
              onInput={(e) => patch({ username: e.currentTarget.value })}
            />
          </label>
          <label>
            {value.backend === 's3' ? 'Secret Access Key' : '密码'}
            <input
              type="password"
              autoComplete="off"
              value={value.password}
              onInput={(e) => patch({ password: e.currentTarget.value })}
            />
          </label>
          <label>
            {'工作区'}{' '}
            <input
              required
              pattern="[a-zA-Z0-9_-]{1,80}"
              value={value.workspace}
              onInput={(e) => patch({ workspace: e.currentTarget.value })}
            />
          </label>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={testing}
              onClick={async () => {
                const controller = new AbortController();
                request.current?.abort();
                request.current = controller;
                setTesting(true);
                setNotice('');
                setError(false);
                try {
                  await send({ type: 'testSync', data: value }, controller.signal);
                  if (!controller.signal.aborted) setNotice('连接正常');
                } catch (e) {
                  if (!controller.signal.aborted) {
                    setError(true);
                    setNotice(e instanceof Error ? e.message : '连接失败');
                  }
                } finally {
                  if (!controller.signal.aborted) setTesting(false);
                }
              }}
            >
              {testing ? '正在测试…' : '测试同步连接'}
            </button>
            <button
              type="button"
              disabled={dirty || status.running}
              title={dirty ? '请先保存设置' : undefined}
              onClick={async () => {
                setStatus((s) => ({ ...s, running: true }));
                try {
                  setStatus(await send({ type: 'syncNow' }));
                } catch (e) {
                  setStatus((s) => ({
                    ...s,
                    running: false,
                    error: e instanceof Error ? e.message : '同步失败',
                  }));
                }
              }}
            >
              {status.running ? '正在同步…' : '立即同步'}
            </button>
          </div>
          {notice && (
            <p class={error ? 'error' : 'notice'} role="status">
              {notice}
            </p>
          )}
          {status.error ? (
            <p class="error" role="status">
              {status.error}
            </p>
          ) : (
            status.lastSuccess && (
              <p class="muted text-sm">
                {'上次同步'} {new Date(status.lastSuccess).toLocaleString()}
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}
