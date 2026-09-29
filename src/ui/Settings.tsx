import { useI18n } from './i18n';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { settingsSchema, type Settings as Configuration } from '../domain/model';
import { send } from '../messages';
import { AIConnection } from './AIConnection';
import { Help } from './Help';
import { Select } from './Select';
import { ExcludedLanguages } from './ExcludedLanguages';
import { SyncSettings } from './SyncSettings';

export function Settings({
  initial,
  saved,
  actions,
  active = true,
}: {
  initial: Configuration;
  saved: (s: Configuration) => void;
  actions: HTMLElement | null;
  active?: boolean;
}) {
  const t = useI18n();
  const [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false),
    [error, setError] = useState('');
  const [ankiBusy, setAnkiBusy] = useState(false),
    [ankiNotice, setAnkiNotice] = useState(''),
    [ankiFailed, setAnkiFailed] = useState(false);
  const ankiRequest = useRef<AbortController>();
  const ankiSequence = useRef(0);
  useEffect(() => {
    ankiRequest.current?.abort();
    setAnkiNotice('');
    setAnkiBusy(false);
    ankiSequence.current++;
    return () => {
      ankiRequest.current?.abort();
      ankiSequence.current++;
    };
  }, [value.ankiUrl, value.ankiKey, active]);
  useEffect(() => {
    const dirty = JSON.stringify(value) !== JSON.stringify(initial);
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (dirty) window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [value, initial]);
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(false), 1500);
    return () => clearTimeout(timer);
  }, [success]);
  const revision = useRef(0);
  const change = (patch: Partial<Configuration>) => {
    revision.current++;
    setSuccess(false);
    setValue((previous) => ({ ...previous, ...patch }));
  };
  return (
    <form
      id="settings-form"
      class="settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setSuccess(false);
        const savingRevision = revision.current;
        setError('');
        try {
          const next = settingsSchema.parse(value);
          await send({ type: 'saveSettings', data: next });
          saved(next);
          if (savingRevision === revision.current) setSuccess(true);
        } catch (err) {
          setError(
            err instanceof Error && err.name !== 'ZodError' ? err.message : t('请检查 API 地址与连接选项'),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {actions &&
        createPortal(
          <button
            type="submit"
            form="settings-form"
            class={`save-button ${success ? 'saved' : ''}`}
            aria-busy={busy}
            disabled={busy}
            title={success ? t('已保存') : t('保存')}
          >
            {busy && (
              <svg class="save-ring" aria-hidden="true" viewBox="0 0 80 36" preserveAspectRatio="none">
                <rect x="1" y="1" width="78" height="34" rx="7" pathLength="100" />
              </svg>
            )}
            {t('保存')}{' '}
          </button>,
          actions,
        )}
      {error && (
        <p class="error" role="alert">
          {t(error)}
        </p>
      )}
      <div class="settings-columns">
        <div class="settings-column">
          <AIConnection value={value} change={change} active={active} />
          <SyncSettings
            value={value.sync}
            saved={initial.sync}
            change={(sync) => change({ sync })}
            active={active}
          />
        </div>
        <div class="settings-column">
          <section class="paper space-y-5">
            <div class="settings-heading">
              <h2>{t('阅读与外观')}</h2>
              <Help label={t('阅读与外观帮助')}>
                {t(
                  '选中词组或已认识的词后按 Alt + Q 查询。自动外观下弹窗跟随网页，记录页跟随系统，复习卡跟随 Anki。 忽略语言不高亮、不响应普通点击；主动选中后仍可用 Alt + Q 查询。',
                )}{' '}
              </Help>
            </div>
            <Select
              label={t('查询方式')}
              value={value.gesture}
              options={[
                { value: 'click', label: t('点击词语') },
                { value: 'alt', label: t('Alt + 点击词语') },
              ]}
              change={(gesture) => change({ gesture: gesture as Configuration['gesture'] })}
            />
            <Select
              label={t('外观')}
              value={value.theme}
              options={[
                { value: 'auto', label: t('自动') },
                { value: 'light', label: t('浅色') },
                { value: 'dark', label: t('深色') },
              ]}
              change={(theme) => change({ theme: theme as Configuration['theme'] })}
            />
            <ExcludedLanguages
              value={value.excludedLanguages}
              change={(excludedLanguages) => change({ excludedLanguages })}
            />
            <Select
              label={t('界面语言')}
              value={value.interfaceLanguage}
              options={[
                { value: 'auto', label: t('自动') },
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
              change={(interfaceLanguage) =>
                change({ interfaceLanguage: interfaceLanguage as Configuration['interfaceLanguage'] })
              }
            />
          </section>
          <section class="paper space-y-5">
            <div class="settings-heading">
              <h2>Anki</h2>
              <Help label={t('Anki 帮助')}>
                {t('打开 Anki 并安装')}{' '}
                <a href="https://ankiweb.net/shared/info/2055492159" target="_blank" rel="noreferrer">
                  AnkiConnect
                </a>
                {t('。例句会自动制卡；Anki 未打开时先保存在本地。')}{' '}
              </Help>
            </div>
            <div class="space-y-5">
              <label>
                {t('AnkiConnect 地址')}{' '}
                <input
                  type="url"
                  required
                  value={value.ankiUrl}
                  onInput={(e) => change({ ankiUrl: e.currentTarget.value })}
                />
              </label>
              <label>
                {t('Anki 牌组')}{' '}
                <input required value={value.deck} onInput={(e) => change({ deck: e.currentTarget.value })} />
              </label>
              <label>
                {t('AnkiConnect 密钥（可选）')}{' '}
                <input
                  type="password"
                  autoComplete="off"
                  value={value.ankiKey}
                  onInput={(e) => change({ ankiKey: e.currentTarget.value })}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={ankiBusy}
              onClick={async () => {
                const id = ++ankiSequence.current;
                ankiRequest.current?.abort();
                const controller = new AbortController();
                ankiRequest.current = controller;
                setAnkiBusy(true);
                setAnkiNotice('');
                setAnkiFailed(false);
                try {
                  await send(
                    { type: 'testAnki', data: { ankiUrl: value.ankiUrl, ankiKey: value.ankiKey } },
                    controller.signal,
                  );
                  if (id === ankiSequence.current) setAnkiNotice(t('Anki 连接正常'));
                } catch (error) {
                  if (id === ankiSequence.current) {
                    setAnkiFailed(true);
                    setAnkiNotice(error instanceof Error ? error.message : t('无法连接 Anki'));
                  }
                } finally {
                  if (id === ankiSequence.current) setAnkiBusy(false);
                }
              }}
            >
              {ankiBusy ? t('正在测试…') : t('测试 Anki 连接')}
            </button>
            {ankiNotice && (
              <p class={ankiFailed ? 'error' : 'notice'} role="status">
                {t(ankiNotice)}
              </p>
            )}
          </section>
        </div>
      </div>
    </form>
  );
}
