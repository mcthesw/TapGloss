import type { RecordView } from '../domain/model';
import { Examples } from './Material';

function Icon({ name }: { name: 'known' | 'edit' | 'delete' }) {
  const paths = {
    known: 'M5 12l4 4L19 6',
    edit: 'M15 5l4 4M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15v5Z',
    delete: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function Record({
  record: r,
  sources,
  compact,
  known,
  edit,
  remove,
  removeSource,
  retry,
}: {
  record: RecordView;
  sources: RecordView[];
  compact: boolean;
  known: () => void;
  edit: () => void;
  remove: () => void;
  removeSource: (id: string) => void;
  retry: () => void;
}) {
  const actions = (
    <div class="record-actions">
      {r.entry && (
        <button
          aria-label={r.state === 'known' ? '恢复学习' : '认识了'}
          title={r.state === 'known' ? '恢复学习' : '认识了'}
          aria-pressed={r.state === 'known'}
          onClick={known}
        >
          {compact ? <Icon name="known" /> : r.state === 'known' ? '已认识 ✓' : '认识了'}
        </button>
      )}
      {r.generation && (
        <button aria-label="编辑" title="编辑" onClick={edit}>
          {compact ? <Icon name="edit" /> : '编辑'}
        </button>
      )}
      <button class="danger" aria-label="删除" title="删除" onClick={remove}>
        {compact ? <Icon name="delete" /> : '删除'}
      </button>
    </div>
  );
  const status =
    r.job?.error ||
    (r.entry?.noteId && !r.job ? '已保存到 Anki' : r.generation ? '已保存 · 等待 Anki' : '正在生成例句…');
  const body = (
    <>
      {r.generation && (
        <>
          <Examples material={r.generation.material} />
          <p class="muted">{r.generation.material.gloss}</p>
        </>
      )}
      <details class="mt-5">
        <summary>原文与来源</summary>
        {!sources.length && <p class="muted mt-4">来源已移除</p>}
        {sources.map((c) => (
          <div class="mt-4" key={c.capture.id}>
            <p class="source">{c.capture.source.sentence}</p>
            <div class="flex items-center justify-between gap-2">
              <a class="muted truncate" href={c.capture.source.url} target="_blank" rel="noreferrer">
                {c.capture.source.title || new URL(c.capture.source.url).hostname}
              </a>
              <button
                class="quiet"
                onClick={() => {
                  if (confirm('删除这条来源？其他材料和 Anki 笔记会保留。')) removeSource(c.capture.id);
                }}
              >
                移除来源
              </button>
            </div>
          </div>
        ))}
      </details>
      <footer class="record-footer mt-5 flex flex-wrap items-center justify-between gap-2 pt-4">
        <span class={r.job?.error ? 'error' : 'muted'}>{status}</span>
        {r.job && (
          <button class="quiet" onClick={retry}>
            重试
          </button>
        )}
        {!compact && actions}
      </footer>
    </>
  );
  return (
    <article class={`paper ${compact ? 'record-compact' : ''}`}>
      <div class={`record-heading ${compact ? '' : 'mb-4'}`}>
        <h2>
          {r.generation?.material.lemma ??
            r.capture.source.sentence.slice(r.capture.source.start, r.capture.source.end)}
        </h2>
        {compact && actions}
      </div>
      {compact ? (
        <>
          {r.job && <p class={r.job.error ? 'error mt-3' : 'muted mt-3'}>{status}</p>}
          <details class="record-details">
            <summary>详情</summary>
            <div class="mt-4">{body}</div>
          </details>
        </>
      ) : (
        body
      )}
    </article>
  );
}
