import { useI18n } from './i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { send, subscribeChanges } from '../messages';
import { vocabularyId, type RecordView, type Source } from '../domain/model';
import { Examples } from './Material';

export function Lookup({ source, x, y, close }: { source: Source; x: number; y: number; close: () => void }) {
  const t = useI18n();
  const [record, setRecord] = useState<RecordView>();
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteAnki, setDeleteAnki] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    const place = () => {
      const rect = root.current!.getBoundingClientRect();
      const left = Math.max(12, Math.min(x, window.innerWidth - rect.width - 12));
      const preferred = y + 12 + rect.height <= window.innerHeight - 12 ? y + 12 : y - rect.height - 12;
      const top = Math.max(12, Math.min(preferred, window.innerHeight - rect.height - 12));
      setPosition((old) => (old.left === left && old.top === top ? old : { left, top }));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root.current!);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [x, y]);
  useEffect(() => {
    let disposed = false,
      sequence = 0,
      id: string | undefined;
    const read = async () => {
      if (!id) return;
      const seq = ++sequence;
      try {
        const next = await send({ type: 'read', data: id });
        if (!disposed && seq === sequence) setRecord(next);
      } catch {
        if (!disposed) setError(t('连接已断开，请刷新页面'));
      }
    };
    const unsubscribe = subscribeChanges((change) => {
      if (change.initial || change.records) void read();
    });
    void send({ type: 'lookup', data: source })
      .then((value) => {
        id = value;
        if (!disposed) void read();
      })
      .catch((e: Error) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  const material = record?.generation?.material;
  const status =
    error ||
    record?.job?.error ||
    (material
      ? record?.entry?.noteId && !record.job
        ? t('已保存到 Anki')
        : record?.job
          ? t('已保存 · 等待 Anki')
          : t('已保存')
      : t('已记下，正在生成例句…'));
  return (
    <section
      class="lookup"
      ref={root}
      role="dialog"
      aria-label={t('语境查询')}
      style={position}
      onClick={(e) => e.stopPropagation()}
    >
      <header class="lookup-header">
        <div class="lookup-term">
          <h2>{material?.lemma ?? source.sentence.slice(source.start, source.end)}</h2>
          {material?.gloss && <p class="lookup-gloss">{material.gloss}</p>}
        </div>
        <button class="quiet lookup-close" aria-label={t('关闭')} onClick={close}>
          ✕
        </button>
      </header>
      <div class="lookup-body">
        {deleting ? (
          <div>
            <p>{t('删除这条学习记录？')}</p>
            <label>
              <input
                type="checkbox"
                checked={deleteAnki}
                disabled={busy}
                onChange={(e) => setDeleteAnki(e.currentTarget.checked)}
              />{' '}
              {t('同时删除 Anki 笔记')}
            </label>
            <p class="muted mt-2">{deleteAnki ? t('将删除关联笔记及复习历史。') : t('Anki 笔记会保留。')}</p>
            <div class="detail-actions">
              <button disabled={busy} onClick={() => setDeleting(false)}>
                {t('取消删除')}
              </button>
              <button
                class="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await send({ type: 'removeLookup', data: { id: record!.capture.id, anki: deleteAnki } });
                    close();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : t('操作未完成'));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('确认删除')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div class="source">
              <div class="label">{t('原文')}</div>
              {source.sentence.replace(/\s+/gu, ' ').trim()}
            </div>
            {material && <Examples material={material} numbered />}
          </>
        )}
      </div>
      <footer class={`lookup-footer ${error || record?.job?.error ? 'has-error' : ''}`}>
        <p class={`lookup-status ${error || record?.job?.error ? 'error' : 'muted'}`} role="status">
          {t(status)}
        </p>
        {!deleting && record?.entry ? (
          <button
            class="lookup-known"
            aria-pressed={record.state === 'known'}
            onClick={async () => {
              try {
                await send({
                  type: 'state',
                  data: {
                    id: vocabularyId(record.entry!.language, record.entry!.lemma),
                    state: record.state === 'known' ? 'learning' : 'known',
                  },
                });
                setRecord({ ...record, state: record.state === 'known' ? 'learning' : 'known' });
              } catch {
                setError(t('暂时无法保存状态'));
              }
            }}
          >
            {record.state === 'known' ? t('恢复学习') : t('认识了')}
          </button>
        ) : (
          <span />
        )}
        {record && !deleting && (
          <button
            class="quiet lookup-manage"
            aria-label={t('删除')}
            title={t('删除')}
            onClick={() => {
              setDeleteAnki(false);
              setDeleting(true);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
            </svg>
          </button>
        )}
        <button
          class="quiet lookup-manage"
          aria-label={t('记录与设置')}
          title={t('记录与设置')}
          onClick={() => {
            void send({ type: 'open' }).catch(() => setError(t('连接已断开，请刷新页面')));
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-9 9M10 5H5v15h15v-5" />
          </svg>
        </button>
      </footer>
    </section>
  );
}
