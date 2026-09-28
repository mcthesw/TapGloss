import { useEffect, useRef, useState } from 'preact/hooks';
import type { Settings } from '../domain/model';
import { send } from '../messages';
import { defaultPrompt } from '../explain/prompt';
import { Help } from './Help';
import { Select } from './Select';

export function AIConnection({
  value,
  change,
}: {
  value: Settings;
  change: (patch: Partial<Settings>) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [promptText, setPromptText] = useState(value.prompt || defaultPrompt);
  const modelEdited = useRef(value.model !== 'deepseek-flash');
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
    setLoading(true);
    setModelNotice('');
    try {
      const found = await send({ type: 'models', data: requested });
      if (id !== sequence.current) return;
      setModels(found);
      if (
        !modelEdited.current &&
        found.length &&
        !found.includes(current.current.model) &&
        current.current.model === requested.model
      )
        change({ model: found.find((model) => /flash|mini|small/i.test(model)) ?? found[0]! });
      setModelNotice(found.length ? `已获取 ${found.length} 个模型` : '未找到模型，可以手动填写名称。');
    } catch (error) {
      if (id === sequence.current)
        setModelNotice(error instanceof Error ? error.message : '获取失败，可手动填写模型。');
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    setModels([]);
    setModelNotice('');
    setLoading(false);
    const timer = setTimeout(() => {
      if (/^https?:\/\//.test(value.baseUrl) && (value.apiKey || !value.baseUrl.includes('api.deepseek.com')))
        void fetchModels();
    }, 800);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [value.baseUrl, value.apiKey]);
  useEffect(() => {
    setTestNotice('');
    setTesting(false);
    testSequence.current++;
  }, [value.baseUrl, value.apiKey, value.model, value.prompt]);
  useEffect(
    () => () => {
      testSequence.current++;
    },
    [],
  );
  return (
    <section class="paper space-y-5 ai-settings">
      <div class="settings-heading">
        <h2>AI 连接</h2>
        <Help label="AI 连接帮助">支持 OpenAI 兼容接口。测试连接会生成一组例句，不保存记录或制卡。</Help>
      </div>
      <label>
        API 地址
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
          placeholder="密钥仅保存在此浏览器"
        />
      </label>
      <Select
        label="模型"
        editable
        value={value.model}
        options={models.map((model) => ({ value: model, label: model }))}
        change={(model) => {
          modelEdited.current = true;
          change({ model });
        }}
      />
      <div class="connection-actions">
        <button type="button" disabled={loading} onClick={() => void fetchModels()}>
          {loading ? '正在获取…' : '刷新模型'}
        </button>
        <button
          type="button"
          disabled={testing || loading}
          onClick={async () => {
            const id = ++testSequence.current;
            setTesting(true);
            setTestNotice('');
            try {
              const result = await send({ type: 'testModel', data: value });
              if (id === testSequence.current)
                setTestNotice(`连接正常 · 例句生成通过（${(result.elapsedMs / 1000).toFixed(1)} 秒）`);
            } catch (error) {
              if (id === testSequence.current)
                setTestNotice(error instanceof Error ? error.message : '测试失败，请检查连接。');
            } finally {
              if (id === testSequence.current) setTesting(false);
            }
          }}
        >
          {testing ? '正在测试…' : '测试连接'}
        </button>
      </div>
      {modelNotice && (
        <p class="muted" aria-live="polite">
          {modelNotice}
        </p>
      )}
      {testNotice && (
        <p class="notice" role="status">
          {testNotice}
        </p>
      )}
      <details>
        <summary>生成提示词</summary>
        <label class="mt-4">
          提示词
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
          恢复默认提示词
        </button>
      </details>
    </section>
  );
}
