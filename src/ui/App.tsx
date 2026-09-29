import { LocaleContext, resolveLocale, translate } from './i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import { send, subscribeChanges } from '../messages';
import type { Job, Settings as Configuration } from '../domain/model';
import { pageSize, type RecordPage } from '../domain/records';
import { Settings } from './Settings';
import { RecordDetail } from './RecordDetail';
import { applyTheme } from './theme';
import { Wordlists } from './Wordlists';

export function App() {
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(() => localStorage.getItem('record-density') === 'compact');
  const [config, setConfig] = useState<Configuration>(),
    [tab, setTab] = useState('records');
  const locale = resolveLocale(config?.interfaceLanguage ?? 'auto');
  const t = (text: string, ...values: (string | number | undefined)[]) => translate(text, locale, ...values);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = 'TapGloss';
  }, [locale]);
  const [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0),
    [page, setPage] = useState<RecordPage>({ records: [] });
  const [selected, setSelected] = useState<string>(),
    [busy, setBusy] = useState(false);
  const [deletions, setDeletions] = useState<Job[]>([]);
  const searchInput = useRef<HTMLInputElement>(null);
  const userNavigated = useRef(false);
  const selectTab = (next: string) => {
    userNavigated.current = true;
    setTab(next);
  };
  const cursors = useRef(new Map<number, [number, string]>());
  useEffect(() => {
    void send({ type: 'settings' })
      .then((s) => {
        setConfig(s);
        if (!userNavigated.current && !s.apiKey && new URL(s.baseUrl).hostname === 'api.deepseek.com')
          setTab('settings');
      })
      .catch(() => setError(t('无法读取设置，请重新打开扩展')));
  }, []);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
      cursors.current.clear();
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (tab !== 'records') return;
    let disposed = false,
      sequence = 0;
    const refresh = async () => {
      const seq = ++sequence;
      setBusy(true);
      try {
        const [next, jobs] = await Promise.all([
          send({
            type: 'list',
            data: { query, offset, examples: !compact, before: cursors.current.get(offset) },
          }),
          send({ type: 'pendingDeletes' }),
        ]);
        if (disposed || seq !== sequence) return;
        if (!next.records.length && offset > 0) {
          setOffset(Math.max(0, offset - pageSize));
          return;
        }
        setPage(next);
        if (next.next !== undefined && next.before) cursors.current.set(next.next, next.before);
        setDeletions(jobs);
        setError('');
      } catch (e) {
        if (!disposed && seq === sequence) setError(e instanceof Error ? e.message : t('读取失败'));
      } finally {
        if (!disposed && seq === sequence) setBusy(false);
      }
    };
    const unsubscribe = subscribeChanges((change) => {
      if (change.initial || change.records) void refresh();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [tab, query, offset, compact]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(document.documentElement, config?.theme ?? 'auto');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [config?.theme]);
  const navigate = (next: number) => {
    setOffset(next);
    window.scrollTo({ top: 0 });
    searchInput.current?.focus();
  };
  return (
    <LocaleContext.Provider value={locale}>
      <main class="app-page">
        <header class="app-header">
          <div class="page-title">
            <h1 class="brand">TapGloss.</h1>
            {tab === 'records' && (
              <input
                ref={searchInput}
                maxLength={200}
                class="record-search"
                aria-label={t('搜索记录')}
                placeholder={t('搜索词语或原句…')}
                value={search}
                onInput={(e) => setSearch(e.currentTarget.value)}
              />
            )}
          </div>
          <div class="header-controls">
            <nav class="page-nav" aria-label={t('页面')}>
              <button
                aria-current={tab === 'records' ? 'page' : undefined}
                onClick={() => selectTab('records')}
              >
                {t('记录')}{' '}
              </button>
              <button
                aria-current={tab === 'wordlists' ? 'page' : undefined}
                onClick={() => selectTab('wordlists')}
              >
                {t('词表')}{' '}
              </button>
              <button
                aria-current={tab === 'settings' ? 'page' : undefined}
                onClick={() => selectTab('settings')}
              >
                {t('设置')}{' '}
              </button>
            </nav>
            <div class="page-actions" ref={setActionHost}>
              {tab === 'records' && (
                <div class="view-switch" role="group" aria-label={t('记录大小')}>
                  {['standard', 'compact'].map((mode) => (
                    <button
                      key={mode}
                      aria-pressed={compact === (mode === 'compact')}
                      onClick={() => {
                        setCompact(mode === 'compact');
                        localStorage.setItem('record-density', mode);
                      }}
                    >
                      {mode === 'compact' ? t('紧凑') : t('标准')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
        {error && (
          <p class="error" role="alert">
            {t(error)}
          </p>
        )}
        {config && (
          <div hidden={tab !== 'settings'}>
            <Settings
              initial={config}
              saved={setConfig}
              actions={tab === 'settings' ? actionHost : null}
              active={tab === 'settings'}
            />
          </div>
        )}
        {tab === 'records' && (
          <>
            {deletions.map((job) => (
              <div class="notice mb-4" key={job.id}>
                {t(job.error || '正在删除 Anki 笔记…')}
                {job.error && (
                  <button
                    class="quiet"
                    onClick={() =>
                      void send({ type: 'retry', data: job.id }).catch((e: Error) => setError(e.message))
                    }
                  >
                    {t('重试删除')}{' '}
                  </button>
                )}
              </div>
            ))}
            {!page.records.length && (
              <section class="empty-records">
                <h2>{busy ? t('读取中…') : query ? t('没有匹配的记录') : t('暂无记录')}</h2>
              </section>
            )}
            <div class={compact ? 'word-list' : 'summary-list'} aria-busy={busy}>
              {page.records.map((r) => (
                <button
                  key={r.id}
                  class={compact ? 'word-item' : 'summary-item'}
                  aria-label={t('查看 {0} 详情', r.term)}
                  onClick={() => setSelected(r.id)}
                >
                  <span class="word-title">{r.term}</span>
                  {r.state === 'known' && (
                    <span class="word-state" title={t('已认识')} aria-label={t('已认识')}>
                      ✓
                    </span>
                  )}
                  {r.job?.error && (
                    <span class="error" title={r.job.error} aria-label={t('需要处理')}>
                      •
                    </span>
                  )}
                  {!compact && (
                    <>
                      <span class="muted summary-gloss">{r.gloss}</span>
                      {r.examples?.map((e) => (
                        <span class="summary-example" key={e.text}>
                          {e.text}
                        </span>
                      ))}
                    </>
                  )}
                </button>
              ))}
            </div>
            {(offset > 0 || page.next !== undefined) && (
              <nav class="pagination" aria-label={t('记录分页')}>
                <button disabled={busy || !offset} onClick={() => navigate(Math.max(0, offset - pageSize))}>
                  {t('上一页')}{' '}
                </button>
                <span class="muted">
                  {offset + 1}–{offset + page.records.length}
                </span>
                <button disabled={busy || page.next === undefined} onClick={() => navigate(page.next!)}>
                  {t('下一页')}{' '}
                </button>
              </nav>
            )}
          </>
        )}
        {selected && <RecordDetail key={selected} id={selected} close={() => setSelected(undefined)} />}
        {tab === 'wordlists' && <Wordlists actions={actionHost} />}
      </main>
    </LocaleContext.Provider>
  );
}
