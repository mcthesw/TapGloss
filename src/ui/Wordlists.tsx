import { AddWordlist } from './AddWordlist';
import { builtinWordlists, builtinSource } from '../wordlists/builtin';
import './wordlists.css';
import { useI18n } from './i18n';
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
  const t = useI18n();
  const [lists, setLists] = useState<Wordlist[]>([]),
    [error, setError] = useState('');
  const [preview, setPreview] = useState<{ name: string; terms: string[]; duplicates: number }>();
  const [mode, setMode] = useState<Wordlist['mode']>('exclude'),
    [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
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
      setError(e instanceof Error ? e.message : t('操作未完成'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {actions &&
        createPortal(
          <button disabled={busy} onClick={() => setAdding(true)}>
            {t('添加词表')}{' '}
          </button>,
          actions,
        )}
      <input
        hidden
        ref={file}
        type="file"
        accept=".txt,.csv,.tsv"
        aria-label={t('选择词表文件')}
        onChange={(e) => {
          const selected = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!selected) return;
          void act(async () => {
            if (selected.size > 10 * 1024 * 1024) throw new Error(t('词表文件不能超过 10 MB'));
            const result = parseWordlist(await selected.text(), selected.name);
            setMode('exclude');
            setPreview({ name: selected.name.replace(/\.[^.]+$/, '').slice(0, 120), ...result });
          });
        }}
      />
      {error && (
        <p class="error" role="alert">
          {t(error)}
        </p>
      )}
      {!lists.length && (
        <section class="empty-records">
          <h2>{t('暂无词表')}</h2>
        </section>
      )}
      <div class="wordlist-list">
        {lists.map((list) => (
          <section class="paper wordlist-card" key={list.id}>
            <div class="settings-heading">
              <div>
                <h2>{list.name}</h2>
                <p class="muted text-sm">
                  {builtinWordlists.some((item) => item.wordlistId === list.id)
                    ? t('{0} 种词形', list.count.toLocaleString())
                    : `${list.count.toLocaleString()} ${t('个词语')}`}
                </p>
                {builtinWordlists.some((item) => item.wordlistId === list.id) && (
                  <a class="muted" href={builtinSource} target="_blank" rel="noreferrer">
                    ECDICT
                  </a>
                )}
              </div>
              <button
                class="quiet wordlist-remove"
                aria-label={t('移除词表 {0}', list.name)}
                title={t('移除词表')}
                disabled={busy}
                onClick={() => setRemoving(list)}
              >
                ×
              </button>
            </div>
            <Select
              label={t('提醒用途')}
              value={list.mode}
              options={modes.map((o) => ({ ...o, label: t(o.label) }))}
              change={(mode) =>
                void act(() =>
                  send({ type: 'changeWordlist', data: { id: list.id, mode: mode as Wordlist['mode'] } }),
                )
              }
            />
            <button
              class="quiet wordlist-toggle"
              aria-pressed={list.enabled}
              disabled={busy}
              onClick={() =>
                void act(() =>
                  send({ type: 'changeWordlist', data: { id: list.id, enabled: !list.enabled } }),
                )
              }
            >
              <span class="toggle-track" aria-hidden="true" />
              {list.enabled ? t('已启用') : t('已停用')}
            </button>
          </section>
        ))}
      </div>
      {adding && (
        <AddWordlist
          lists={lists}
          close={() => setAdding(false)}
          file={() => {
            setAdding(false);
            file.current?.click();
          }}
        />
      )}
      {preview && (
        <Modal title="wordlist-import-title" close={() => setPreview(undefined)}>
          <div class="settings-heading">
            <h2 id="wordlist-import-title">{t('导入词表')}</h2>
            <Help label={t('词表帮助')}>
              {t(
                '支持 UTF-8 的 TXT、CSV 和 TSV，每份最多十万个词语。多份“只提醒表内词”合并生效，“忽略表内词”从中排除；个人明确标记的学习中或认识状态优先。移除词表不删除学习记录。',
              )}{' '}
            </Help>
          </div>
          <label>
            {t('名称')}{' '}
            <input
              autoFocus
              maxLength={120}
              value={preview.name}
              onInput={(e) => setPreview({ ...preview, name: e.currentTarget.value })}
            />
          </label>
          <Select
            label={t('提醒用途')}
            value={mode}
            options={modes.map((o) => ({ ...o, label: t(o.label) }))}
            change={(value) => setMode(value as Wordlist['mode'])}
          />
          <p class="muted">
            {preview.terms.length.toLocaleString()} {t('个词语')}{' '}
            {preview.duplicates > 0 && t(' · 已去重 {0} 项', preview.duplicates)}
          </p>
          <div class="wordlist-preview">
            {preview.terms.slice(0, 20).map((term) => (
              <span key={term}>{term}</span>
            ))}
          </div>
          {error && (
            <p class="error" role="alert">
              {t(error)}
            </p>
          )}
          <div class="detail-actions">
            <button disabled={busy} onClick={() => setPreview(undefined)}>
              {t('取消')}{' '}
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
              {busy ? t('正在导入…') : t('导入')}
            </button>
          </div>
        </Modal>
      )}
      {removing && (
        <Modal title="wordlist-remove-title" close={() => setRemoving(undefined)}>
          <h2 id="wordlist-remove-title">{t('移除词表？')}</h2>
          <p>{removing.name}</p>
          <p class="muted">{t('个人状态与学习记录会保留。')}</p>
          <div class="detail-actions">
            <button disabled={busy} onClick={() => setRemoving(undefined)}>
              {t('取消')}{' '}
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
              {t('移除')}{' '}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
