import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { send, subscribeChanges } from '../messages';
import type { Wordlist } from '../domain/wordlists';
import { parseWordlist } from './parse-wordlist';
import { Modal } from './Modal';
import { Select } from './Select';
import { Help } from './Help';

const modes = [
  { value: 'exclude', label: '忽略表内词' },
  { value: 'include', label: '只提醒表内词' },
];
export function Wordlists({ actions }: { actions: HTMLElement | null }) {
  const [lists, setLists] = useState<Wordlist[]>([]),
    [error, setError] = useState('');
  const [preview, setPreview] = useState<{ name: string; terms: string[]; duplicates: number }>();
  const [mode, setMode] = useState<Wordlist['mode']>('exclude'),
    [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Wordlist>();
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let disposed = false;
    const unsubscribe = subscribeChanges((c) => {
      if (c.initial || c.wordlists)
        void send({ type: 'wordlists' })
          .then((rows) => {
            if (!disposed) setLists(rows);
          })
          .catch((e: Error) => setError(e.message));
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {actions &&
        createPortal(
          <button disabled={busy} onClick={() => file.current?.click()}>
            {'导入词表'}{' '}
          </button>,
          actions,
        )}
      <input
        hidden
        ref={file}
        type="file"
        accept=".txt,.csv,.tsv"
        aria-label={'选择词表文件'}
        onChange={(e) => {
          const selected = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!selected) return;
          void act(async () => {
            if (selected.size > 10 * 1024 * 1024) throw new Error('词表文件不能超过 10 MB');
            const result = parseWordlist(await selected.text(), selected.name);
            setMode('exclude');
            setPreview({ name: selected.name.replace(/\.[^.]+$/, '').slice(0, 120), ...result });
          });
        }}
      />
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {!lists.length && (
        <section class="empty-records">
          <h2>{'让阅读提醒更适合你'}</h2>
          <p class="muted">{'导入自己的词表，减少熟悉词语的提醒，或专注于想学的词语。'}</p>
        </section>
      )}
      <div class="wordlist-list">
        {lists.map((list) => (
          <section class="paper wordlist-card" key={list.id}>
            <div class="settings-heading">
              <div>
                <h2>{list.name}</h2>
                <p class="muted text-sm">
                  {list.count.toLocaleString()} {'个词语'}
                </p>
              </div>
              <button
                class="quiet"
                aria-label={`移除词表 ${list.name}`}
                title={'移除词表'}
                disabled={busy}
                onClick={() => setRemoving(list)}
              >
                ×
              </button>
            </div>
            <Select
              label={'提醒用途'}
              value={list.mode}
              options={modes.map((o) => ({ ...o, label: o.label }))}
              change={(mode) =>
                void act(() =>
                  send({ type: 'changeWordlist', data: { id: list.id, mode: mode as Wordlist['mode'] } }),
                )
              }
            />
            <button
              class="quiet"
              aria-pressed={list.enabled}
              disabled={busy}
              onClick={() =>
                void act(() =>
                  send({ type: 'changeWordlist', data: { id: list.id, enabled: !list.enabled } }),
                )
              }
            >
              {list.enabled ? '✓ 已启用' : '已停用'}
            </button>
          </section>
        ))}
      </div>
      {preview && (
        <Modal title="wordlist-import-title" close={() => setPreview(undefined)}>
          <div class="settings-heading">
            <h2 id="wordlist-import-title">{'导入词表'}</h2>
            <Help label={'词表帮助'}>
              {
                '支持 UTF-8 的 TXT、CSV 和 TSV，每份最多十万个词语。多份“只提醒表内词”合并生效，“忽略表内词”从中排除；个人明确标记的学习中或认识状态优先。移除词表不删除学习记录。'
              }{' '}
            </Help>
          </div>
          <label>
            {'名称'}{' '}
            <input
              autoFocus
              maxLength={120}
              value={preview.name}
              onInput={(e) => setPreview({ ...preview, name: e.currentTarget.value })}
            />
          </label>
          <Select
            label={'提醒用途'}
            value={mode}
            options={modes.map((o) => ({ ...o, label: o.label }))}
            change={(value) => setMode(value as Wordlist['mode'])}
          />
          <p class="muted">
            {preview.terms.length.toLocaleString()} {'个词语'}{' '}
            {preview.duplicates > 0 && ` · 已去重 ${preview.duplicates} 项`}
          </p>
          <div class="wordlist-preview">
            {preview.terms.slice(0, 20).map((term) => (
              <span key={term}>{term}</span>
            ))}
          </div>
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
          <div class="detail-actions">
            <button disabled={busy} onClick={() => setPreview(undefined)}>
              {'取消'}{' '}
            </button>
            <button
              class="primary"
              disabled={busy || !preview.name.trim()}
              onClick={() =>
                void act(async () => {
                  await send({
                    type: 'importWordlist',
                    data: { name: preview.name, mode, terms: preview.terms },
                  });
                  setPreview(undefined);
                })
              }
            >
              {busy ? '正在导入…' : '导入'}
            </button>
          </div>
        </Modal>
      )}
      {removing && (
        <Modal title="wordlist-remove-title" close={() => setRemoving(undefined)}>
          <h2 id="wordlist-remove-title">{'移除词表？'}</h2>
          <p>{removing.name}</p>
          <p class="muted">{'个人状态与学习记录会保留。'}</p>
          <div class="detail-actions">
            <button disabled={busy} onClick={() => setRemoving(undefined)}>
              {'取消'}{' '}
            </button>
            <button
              class="danger"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await send({ type: 'changeWordlist', data: { id: removing.id, remove: true } });
                  setRemoving(undefined);
                })
              }
            >
              {'移除'}{' '}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
