import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { send } from '../messages';
import { vocabularyId, type RecordView, type Source } from '../domain/model';
import { Examples } from './Material';

export function Lookup({
  source,
  x,
  y,
  close,
  refresh,
}: {
  source: Source;
  x: number;
  y: number;
  close: () => void;
  refresh: () => void;
}) {
  const [record, setRecord] = useState<RecordView>();
  const [error, setError] = useState('');
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
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    void send({ type: 'lookup', data: source })
      .then(async (id) => {
        const poll = async () => {
          if (cancelled) return;
          try {
            const next = await send({ type: 'read', data: id });
            if (!cancelled) {
              setRecord(next);
              refresh();
            }
          } catch {
            if (!cancelled) setError('连接已断开，请刷新页面');
          }
          if (!cancelled)
            timer = setTimeout(() => {
              void poll();
            }, 1500);
        };
        await poll();
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  const material = record?.generation?.material;
  const status =
    error ||
    record?.job?.error ||
    (material
      ? record?.entry?.noteId && !record.job
        ? '已保存到 Anki'
        : '已保存 · 等待 Anki'
      : '已记下，正在生成例句…');
  return (
    <section
      class="lookup"
      ref={root}
      role="dialog"
      aria-label="语境查询"
      style={position}
      onClick={(e) => e.stopPropagation()}
    >
      <header class="lookup-header">
        <div class="lookup-term">
          <h2>{material?.lemma ?? source.sentence.slice(source.start, source.end)}</h2>
          {material?.gloss && <p class="lookup-gloss">{material.gloss}</p>}
        </div>
        <button class="quiet lookup-close" aria-label="关闭" onClick={close}>
          ✕
        </button>
      </header>
      <div class="lookup-body">
        <div class="source">
          <div class="label">原文</div>
          {source.sentence.replace(/\s+/gu, ' ').trim()}
        </div>
        {material && <Examples material={material} numbered />}
      </div>
      <footer class={`lookup-footer ${error || record?.job?.error ? 'has-error' : ''}`}>
        <p class={`lookup-status ${error || record?.job?.error ? 'error' : 'muted'}`} role="status">
          {status}
        </p>
        {record?.entry ? (
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
                refresh();
              } catch {
                setError('暂时无法保存状态');
              }
            }}
          >
            {record.state === 'known' ? '恢复学习' : '认识了'}
          </button>
        ) : (
          <span />
        )}
        <button
          class="quiet lookup-manage"
          aria-label="记录与设置"
          title="记录与设置"
          onClick={() => {
            void send({ type: 'open' });
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
