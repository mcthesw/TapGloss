import { useEffect, useRef, useState } from 'preact/hooks';
import { builtinSource, builtinWordlists } from '../wordlists/builtin';
import type { Wordlist } from '../domain/wordlists';
import { send } from '../messages';
import { Modal } from './Modal';
import { Select } from './Select';
import { useI18n } from './i18n';
export function AddWordlist({
  lists,
  file,
  close,
}: {
  lists: Wordlist[];
  file: () => void;
  close: () => void;
}) {
  const t = useI18n();
  const [mode, setMode] = useState<Wordlist['mode']>('exclude');
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  return (
    <Modal title="add-wordlist-title" close={close}>
      <div class="detail-heading">
        <h2 id="add-wordlist-title">{t('添加词表')}</h2>
        <button class="quiet" aria-label={t('关闭')} onClick={close}>
          ✕
        </button>
      </div>
      <Select
        label={t('提醒用途')}
        value={mode}
        options={[
          { value: 'exclude', label: t('忽略表内词') },
          { value: 'include', label: t('只提醒表内词') },
        ]}
        change={(value) => setMode(value as Wordlist['mode'])}
      />
      <div class="builtin-lists">
        {builtinWordlists.map((item) => {
          const added = lists.some((list) => list.id === item.wordlistId);
          return (
            <div class="builtin-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span class="muted">{t('{0} 个词条', item.headwords.toLocaleString())}</span>
              </div>
              <button
                disabled={!!busy || added}
                onClick={async () => {
                  const request = new AbortController();
                  controller.current = request;
                  setBusy(item.id);
                  setError('');
                  try {
                    await send({ type: 'importBuiltin', data: { id: item.id, mode } }, request.signal);
                  } catch (e) {
                    if (!request.signal.aborted)
                      setError(e instanceof Error ? e.message : t('词表下载失败，请重试'));
                  } finally {
                    if (!request.signal.aborted) setBusy('');
                  }
                }}
              >
                {added ? t('已添加') : busy === item.id ? t('下载中…') : t('添加')}
              </button>
            </div>
          );
        })}
      </div>
      {error && (
        <p class="error" role="alert">
          {t(error)}
        </p>
      )}
      <details class="builtin-source">
        <summary>{t('词表来源')}</summary>
        <p class="muted">
          {t('ECDICT 考试标签词表，包含中高考基础词和常见词形；六级包含四级。不代表官方大纲完整词表。')}
        </p>
        <a href={builtinSource} target="_blank" rel="noreferrer">
          ECDICT · MIT
        </a>
      </details>
      <div class="detail-actions">
        <button disabled={!!busy} onClick={file}>
          {t('导入文件')}
        </button>
      </div>
    </Modal>
  );
}
