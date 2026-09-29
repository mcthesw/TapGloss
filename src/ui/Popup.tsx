import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { send, subscribeChanges } from '../messages';
import { siteHostname, type ReadingControls } from '../domain/reading';
import { resolveLocale, translate } from './i18n';
import { applyTheme } from './theme';

export function Popup() {
  const [controls, setControls] = useState<ReadingControls>();
  const [host, setHost] = useState<string>();
  const [supported, setSupported] = useState(false);
  const [locale, setLocale] = useState(resolveLocale('auto'));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const t = (text: string) => translate(text, locale);
  useEffect(() => {
    void Promise.all([send({ type: 'settings' }), browser.tabs.query({ active: true, currentWindow: true })])
      .then(async ([settings, tabs]) => {
        setLocale(resolveLocale(settings.interfaceLanguage));
        applyTheme(document.documentElement, settings.theme);
        const tab = tabs[0];
        setHost(siteHostname(tab?.url));
        if (tab?.id !== undefined && siteHostname(tab.url)) {
          try {
            await browser.tabs.sendMessage(tab.id, { type: 'readingProbe' });
            setSupported(true);
          } catch {
            setSupported(false);
          }
        }
      })
      .catch(() => setError(t('无法读取设置，请重新打开扩展')));
    return subscribeChanges(() => {
      void send({ type: 'readingControls' })
        .then(setControls)
        .catch(() => setError(t('连接已断开，请刷新页面')));
    });
  }, []);
  const change = async (data: { enabled?: boolean; hostname?: string; siteEnabled?: boolean }) => {
    setBusy(true);
    setError('');
    try {
      setControls(await send({ type: 'changeReadingControls', data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('操作未完成'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="quick-panel">
      <div class="quick-row">
        <h1>TapGloss.</h1>
        <button
          class="quiet wordlist-toggle"
          aria-pressed={controls?.enabled ?? false}
          disabled={!controls || busy}
          onClick={() => void change({ enabled: !controls?.enabled })}
        >
          <span class="toggle-track" aria-hidden="true" />
          {controls?.enabled ? t('开启') : t('已暂停')}
        </button>
      </div>
      <div class="quick-row">
        <span class="quick-host">{host ?? t('此页面不支持')}</span>
        {host && (
          <button
            class="quiet wordlist-toggle"
            aria-label={t('在此网站启用')}
            aria-pressed={!controls?.disabledSites.includes(host)}
            disabled={!controls || busy || !supported}
            onClick={() =>
              void change({ hostname: host, siteEnabled: controls?.disabledSites.includes(host) })
            }
          >
            <span class="toggle-track" aria-hidden="true" />
            {controls?.disabledSites.includes(host) ? t('已停用') : t('已启用')}
          </button>
        )}
      </div>
      {host && !supported && <p class="muted">{t('此页面未连接，请刷新网页后重试')}</p>}
      {error && (
        <p class="error" role="alert">
          {t(error)}
        </p>
      )}
      <nav class="quick-nav">
        {(['records', 'wordlists', 'settings'] as const).map((tab, i) => (
          <button
            class="quiet"
            key={tab}
            onClick={() => {
              void browser.tabs.create({ url: browser.runtime.getURL('/options.html') + '#' + tab });
              window.close();
            }}
          >
            {t(['记录', '词表', '设置'][i]!)}
          </button>
        ))}
      </nav>
    </main>
  );
}
