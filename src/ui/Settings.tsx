import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { settingsSchema, type Settings as Configuration } from '../domain/model';
import { send } from '../messages';
import { AIConnection } from './AIConnection';
import { Help } from './Help';
import { Select } from './Select';

export function Settings({
  initial,
  saved,
  actions,
}: {
  initial: Configuration;
  saved: (s: Configuration) => void;
  actions: HTMLElement | null;
}) {
  const [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false),
    [error, setError] = useState('');
  const [ankiBusy, setAnkiBusy] = useState(false),
    [ankiNotice, setAnkiNotice] = useState(''),
    [ankiFailed, setAnkiFailed] = useState(false);
  const ankiSequence = useRef(0);
  useEffect(() => {
    setAnkiNotice('');
    setAnkiBusy(false);
    ankiSequence.current++;
    return () => {
      ankiSequence.current++;
    };
  }, [value.ankiUrl, value.ankiKey]);
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
            err instanceof Error && err.name !== 'ZodError' ? err.message : '请检查 API 地址与连接选项',
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
            title={success ? '已保存' : '保存'}
          >
            {busy && (
              <svg class="save-ring" aria-hidden="true" viewBox="0 0 80 36" preserveAspectRatio="none">
                <rect x="1" y="1" width="78" height="34" rx="7" pathLength="100" />
              </svg>
            )}
            保存
          </button>,
          actions,
        )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="settings-columns">
        <div class="settings-column">
          <AIConnection value={value} change={change} />
        </div>
        <div class="settings-column">
          <section class="paper space-y-5">
            <div class="settings-heading">
              <h2>阅读与外观</h2>
              <Help label="阅读与外观帮助">
                选中词组或已认识的词后按 Alt + Q 查询。自动外观下弹窗跟随网页，记录页跟随系统，复习卡跟随
                Anki。
              </Help>
            </div>
            <Select
              label="查询方式"
              value={value.gesture}
              options={[
                { value: 'click', label: '点击词语' },
                { value: 'alt', label: 'Alt + 点击词语' },
              ]}
              change={(gesture) => change({ gesture: gesture as Configuration['gesture'] })}
            />
            <Select
              label="外观"
              value={value.theme}
              options={[
                { value: 'auto', label: '自动' },
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
              ]}
              change={(theme) => change({ theme: theme as Configuration['theme'] })}
            />
          </section>
          <section class="paper space-y-5">
            <div class="settings-heading">
              <h2>Anki</h2>
              <Help label="Anki 帮助">
                打开 Anki 并安装{' '}
                <a href="https://ankiweb.net/shared/info/2055492159" target="_blank" rel="noreferrer">
                  AnkiConnect
                </a>
                。例句会自动制卡；Anki 未打开时先保存在本地。
              </Help>
            </div>
            <div class="space-y-5">
              <label>
                AnkiConnect 地址
                <input
                  type="url"
                  required
                  value={value.ankiUrl}
                  onInput={(e) => change({ ankiUrl: e.currentTarget.value })}
                />
              </label>
              <label>
                Anki 牌组
                <input required value={value.deck} onInput={(e) => change({ deck: e.currentTarget.value })} />
              </label>
              <label>
                AnkiConnect 密钥（可选）
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
                setAnkiBusy(true);
                setAnkiNotice('');
                setAnkiFailed(false);
                try {
                  await send({ type: 'testAnki', data: { ankiUrl: value.ankiUrl, ankiKey: value.ankiKey } });
                  if (id === ankiSequence.current) setAnkiNotice('Anki 连接正常');
                } catch (error) {
                  if (id === ankiSequence.current) {
                    setAnkiFailed(true);
                    setAnkiNotice(error instanceof Error ? error.message : '无法连接 Anki');
                  }
                } finally {
                  if (id === ankiSequence.current) setAnkiBusy(false);
                }
              }}
            >
              {ankiBusy ? '正在测试…' : '测试 Anki 连接'}
            </button>
            {ankiNotice && (
              <p class={ankiFailed ? 'error' : 'notice'} role="status">
                {ankiNotice}
              </p>
            )}
          </section>
        </div>
      </div>
    </form>
  );
}
