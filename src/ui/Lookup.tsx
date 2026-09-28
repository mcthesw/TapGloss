import { useEffect, useState } from 'preact/hooks';
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
      role="dialog"
      aria-label="语境查询"
      style={{
        left: Math.max(12, Math.min(x, window.innerWidth - 394)),
        top: Math.max(12, Math.min(y + 12, window.innerHeight - 480)),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="flex items-start justify-between gap-3">
        <h2>{material?.lemma ?? source.sentence.slice(source.start, source.end)}</h2>
        <button class="quiet" aria-label="关闭" onClick={close}>
          ✕
        </button>
      </div>
      <div class="source">
        <div class="label">原文</div>
        {source.sentence}
      </div>
      {material && (
        <>
          <Examples material={material} />
          {material.gloss && <p class="muted">{material.gloss}</p>}
        </>
      )}
      <p class={error || record?.job?.error ? 'error' : 'muted'} role="status">
        {status}
      </p>
      <footer>
        {record?.entry ? (
          <button
            class="quiet"
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
          class="quiet"
          onClick={() => {
            void send({ type: 'open' });
          }}
        >
          记录与设置 ↗
        </button>
      </footer>
    </section>
  );
}
