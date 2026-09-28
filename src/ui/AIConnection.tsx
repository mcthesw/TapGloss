import { useI18n } from './i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Settings } from '../domain/model';
import { send } from '../messages';
import { defaultPrompt } from '../explain/prompt';
import { Help } from './Help';
import { Select } from './Select';

export function AIConnection({
  value,
  change,
  active = true,
}: {
  value: Settings;
  active?: boolean;
  change: (patch: Partial<Settings>) => void;
}) {
  const t = useI18n();
  const [models, setModels] = useState<string[]>([]);
  const [promptText, setPromptText] = useState(value.prompt || defaultPrompt);
  const discovery = useRef<AbortController>();
  const testingRequest = useRef<AbortController>();
  const [loading, setLoading] = useState(false),
    [testing, setTesting] = useState(false);
  const [modelNotice, setModelNotice] = useState(''),
    [testNotice, setTestNotice] = useState('');
  const current = useRef(value);
  current.current = value;
  const sequence = useRef(0),
    testSequence = useRef(0);
  const fetchModels = async () => {
    const id = ++sequence.current;
    const requested = current.current;
    discovery.current?.abort();
    const controller = new AbortController();
    discovery.current = controller;
    setLoading(true);
    setModelNotice('');
    try {
      const found = await send({ type: 'models', data: requested }, controller.signal);
      if (id !== sequence.current) return;
      setModels(found);
      setModelNotice(
        found.length ? t('已获取 {0} 个模型', found.length) : t('未找到模型，可以手动填写名称。'),
      );
    } catch (error) {
      if (id === sequence.current)
        setModelNotice(error instanceof Error ? error.message : t('获取失败，可手动填写模型。'));
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    setModels([]);
    setModelNotice('');
    setLoading(false);
    discovery.current?.abort();
    sequence.current++;
    return () => {
      discovery.current?.abort();
      sequence.current++;
    };
  }, [value.baseUrl, value.apiKey]);
  useEffect(() => {
    if (!active) {
      discovery.current?.abort();
      sequence.current++;
      setLoading(false);
    }
  }, [active]);
  useEffect(() => {
    testingRequest.current?.abort();
    setTestNotice('');
    setTesting(false);
    testSequence.current++;
  }, [value.baseUrl, value.apiKey, value.model, value.prompt, active]);
  useEffect(
    () => () => {
      testingRequest.current?.abort();
      testSequence.current++;
    },
    [],
  );
  return (
    <section class="paper space-y-5 ai-settings">
      <div class="settings-heading">
        <h2>{t('AI 连接')}</h2>
        <Help label={t('AI 连接帮助')}>
          {t('支持 OpenAI 兼容接口。测试连接会生成一组例句，不保存记录或制卡。')}
        </Help>
      </div>
      <label>
        {t('API 地址')}{' '}
        <input
          type="url"
          required
          value={value.baseUrl}
          onInput={(e) => change({ baseUrl: e.currentTarget.value })}
          placeholder="https://api.example.com/v1"
        />
      </label>
      <label>
        API Key
        <input
          type="password"
          autoComplete="off"
          value={value.apiKey}
          onInput={(e) => change({ apiKey: e.currentTarget.value })}
          placeholder={t('密钥仅保存在此浏览器')}
        />
      </label>
      <Select
        label={t('模型')}
        editable
        value={value.model}
        options={models.map((model) => ({ value: model, label: model }))}
        change={(model) => {
          change({ model });
        }}
      />
      <div class="connection-actions">
        <button type="button" disabled={loading} onClick={() => void fetchModels()}>
          {loading ? t('正在获取…') : t('获取模型')}
        </button>
        <button
          type="button"
          disabled={testing || loading}
          onClick={async () => {
            const id = ++testSequence.current;
            testingRequest.current?.abort();
            const controller = new AbortController();
            testingRequest.current = controller;
            setTesting(true);
            setTestNotice('');
            try {
              const result = await send({ type: 'testModel', data: value }, controller.signal);
              if (id === testSequence.current)
                setTestNotice(t('连接正常 · 例句生成通过（{0} 秒）', (result.elapsedMs / 1000).toFixed(1)));
            } catch (error) {
              if (id === testSequence.current)
                setTestNotice(error instanceof Error ? error.message : t('测试失败，请检查连接。'));
            } finally {
              if (id === testSequence.current) setTesting(false);
            }
          }}
        >
          {testing ? t('正在测试…') : t('测试连接')}
        </button>
      </div>
      {modelNotice && (
        <p class="muted" aria-live="polite">
          {t(modelNotice)}
        </p>
      )}
      {testNotice && (
        <p class="notice" role="status">
          {t(testNotice)}
        </p>
      )}
      <details>
        <summary>{t('生成提示词')}</summary>
        <label class="mt-4">
          {t('提示词')}{' '}
          <textarea
            class="prompt-input"
            maxLength={12000}
            value={promptText}
            onInput={(e) => {
              setPromptText(e.currentTarget.value);
              change({ prompt: e.currentTarget.value });
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setPromptText(defaultPrompt);
            change({ prompt: '' });
          }}
        >
          {t('恢复默认提示词')}{' '}
        </button>
      </details>
    </section>
  );
}
