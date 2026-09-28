import { useEffect, useState } from 'preact/hooks';
import { send } from '../messages';
import {
  vocabularyId,
  type Material,
  type Job,
  type RecordView,
  type Settings as Configuration,
} from '../domain/model';
import { Record } from './Record';
import { applyTheme } from './theme';
import { Settings } from './Settings';
import { Modal } from './Modal';

export function App() {
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(() => localStorage.getItem('record-density') === 'compact');
  const [config, setConfig] = useState<Configuration>(),
    [tab, setTab] = useState('records');
  const [records, setRecords] = useState<RecordView[]>([]),
    [error, setError] = useState(''),
    [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<RecordView>(),
    [deleteAnki, setDeleteAnki] = useState(false);
  const [editing, setEditing] = useState<RecordView>(),
    [draft, setDraft] = useState<Material>();
  const [pendingDeletion, setPendingDeletion] = useState<Job[]>([]);
  const refresh = async () => {
    const result = await send({ type: 'list' });
    setRecords(result.records);
    setPendingDeletion(result.jobs.filter((j) => j.kind === 'delete'));
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成');
    }
  };
  useEffect(() => {
    void send({ type: 'settings' })
      .then((s) => {
        setConfig(s);
        if (!s.apiKey && s.baseUrl.includes('api.deepseek.com')) setTab('settings');
      })
      .catch(() => setError('无法读取设置，请重新打开扩展'));
    void act(refresh);
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(document.documentElement, config?.theme ?? 'auto');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [config?.theme]);
  const unique = records.filter(
    (r, i, all) => !r.entry || all.findIndex((a) => a.entry?.id === r.entry?.id) === i,
  );
  const visible = unique.filter((r) =>
    `${r.entry?.lemma ?? ''} ${r.capture.source.sentence} ${r.generation?.material.gloss ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <main class="app-page">
      <header class="app-header">
        <div>
          <h1 class="brand">
            TapGloss<span>.</span>
          </h1>
          <p class="muted mt-1">点一下，理解语境，记住表达。</p>
        </div>
        <div class="header-controls">
          <nav class="page-nav" aria-label="页面">
            <button aria-current={tab === 'records' ? 'page' : undefined} onClick={() => setTab('records')}>
              记录
            </button>
            <button aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}>
              设置
            </button>
          </nav>
          <div class="page-actions" ref={setActionHost}>
            {tab === 'records' && (
              <div class="view-switch" role="group" aria-label="记录大小">
                {(['standard', 'compact'] as const).map((mode) => (
                  <button
                    aria-pressed={compact === (mode === 'compact')}
                    onClick={() => {
                      setCompact(mode === 'compact');
                      localStorage.setItem('record-density', mode);
                    }}
                  >
                    {mode === 'compact' ? '紧凑' : '标准'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      {error && (
        <p role="alert" class="error mb-5">
          {error}
        </p>
      )}
      {tab === 'settings' ? (
        config && <Settings initial={config} saved={setConfig} actions={actionHost} />
      ) : (
        <>
          <input
            aria-label="搜索记录"
            placeholder="找一个词，或一句读过的话…"
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="mb-6"
          />
          {pendingDeletion.map((job) => (
            <div class="notice mb-4" key={job.id}>
              {job.error || '正在删除 Anki 笔记…'}
              {job.error && (
                <button class="quiet" onClick={() => void act(() => send({ type: 'retry', data: job.id }))}>
                  重试删除
                </button>
              )}
            </div>
          ))}
          {!visible.length && (
            <section class="paper py-16 text-center">
              <h2 class="mb-3">从一个想了解的词开始</h2>
              <p class="muted">在网页上点选词语，语境和例句就会留在这里。</p>
            </section>
          )}
          <div class={compact ? 'compact-records' : 'space-y-5'}>
            {visible.map((r) => (
              <Record
                key={`${r.entry?.id ?? r.capture.id}:${compact}`}
                record={r}
                compact={compact}
                sources={records.filter(
                  (c) =>
                    !c.capture.deleted &&
                    (r.entry ? c.entry?.id === r.entry.id : c.capture.id === r.capture.id),
                )}
                known={() =>
                  void act(() =>
                    send({
                      type: 'state',
                      data: {
                        id: vocabularyId(r.entry!.language, r.entry!.lemma),
                        state: r.state === 'known' ? 'learning' : 'known',
                      },
                    }),
                  )
                }
                edit={() => {
                  setEditing(r);
                  setDraft(structuredClone(r.generation!.material));
                }}
                remove={() => {
                  setDeleting(r);
                  setDeleteAnki(false);
                }}
                removeSource={(id) => void act(() => send({ type: 'removeSource', data: id }))}
                retry={() => void act(() => send({ type: 'retry', data: r.job!.id }))}
              />
            ))}
          </div>
        </>
      )}
      {deleting && (
        <Modal title="delete-title" close={() => setDeleting(undefined)}>
          <h2 id="delete-title" class="mb-4">
            删除这条学习记录？
          </h2>
          <p>此义项的例句和来源会从 TapGloss 移除。</p>
          {deleting.entry && (
            <label class="my-5 flex items-center gap-2">
              <input
                type="checkbox"
                checked={deleteAnki}
                onChange={(e) => setDeleteAnki(e.currentTarget.checked)}
              />
              同时删除 Anki 笔记
            </label>
          )}
          <p class="muted">
            {deleteAnki ? '只删除这条记录对应的 TapGloss 笔记及其复习历史。' : 'Anki 中的笔记会保留。'}
          </p>
          <div class="mt-6 flex justify-end gap-3">
            <button onClick={() => setDeleting(undefined)}>取消</button>
            <button
              class="danger"
              onClick={() =>
                void act(async () => {
                  await (deleting.entry
                    ? send({ type: 'remove', data: { id: deleting.entry.id, anki: deleteAnki } })
                    : send({ type: 'removeSource', data: deleting.capture.id }));
                  setDeleting(undefined);
                })
              }
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
      {editing && draft && (
        <Modal title="edit-title" close={() => setEditing(undefined)}>
          <h2 id="edit-title" class="mb-5">
            修正学习材料
          </h2>
          <label>
            简短释义
            <textarea
              value={draft.gloss}
              onInput={(e) => setDraft({ ...draft, gloss: e.currentTarget.value })}
            />
          </label>
          {draft.examples.map((e, i) => (
            <div class="mt-4" key={i}>
              <label>
                例句 {i + 1}
                <textarea
                  value={e.text}
                  onInput={(event) =>
                    setDraft({
                      ...draft,
                      examples: draft.examples.map((a, j) =>
                        j === i ? { ...a, text: event.currentTarget.value } : a,
                      ),
                    })
                  }
                />
              </label>
              <label class="mt-2">
                挖空表达
                <input
                  value={e.target}
                  onInput={(event) =>
                    setDraft({
                      ...draft,
                      examples: draft.examples.map((a, j) =>
                        j === i ? { ...a, target: event.currentTarget.value } : a,
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}
          <div class="mt-6 flex justify-end gap-3">
            <button onClick={() => setEditing(undefined)}>取消</button>
            <button
              class="primary"
              onClick={() =>
                void act(async () => {
                  await send({ type: 'edit', data: { id: editing.entry!.id, material: draft } });
                  setEditing(undefined);
                })
              }
            >
              保存
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
