import { useI18n } from './i18n';
import { useEffect, useState } from 'preact/hooks';
import { send, subscribeChanges } from '../messages';
import { vocabularyId, type Material } from '../domain/model';
import type { RecordDetail as Detail } from '../domain/records';
import { Modal } from './Modal';
import { Examples } from './Material';

export function RecordDetail({ id, close }: { id: string; close: () => void }) {
  const t = useI18n();
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Material>();
  const [deleting, setDeleting] = useState(false),
    [deleteAnki, setDeleteAnki] = useState(false);
  const [sourcePage, setSourcePage] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let sequence = 0,
      disposed = false;
    const refresh = async () => {
      const seq = ++sequence;
      try {
        const next = await send({ type: 'detail', data: { id, offset: sourcePage * 20 } });
        if (disposed || seq !== sequence) return;
        if (!next) close();
        else setDetail(next);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : t('无法读取记录'));
      }
    };
    const unsubscribe = subscribeChanges((change) => {
      if (change.initial || change.records) void refresh();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [id, sourcePage]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('操作未完成'));
    } finally {
      setBusy(false);
    }
  };
  const record = detail?.record,
    entry = record?.entry,
    material = record?.generation?.material;
  const term =
    material?.lemma ??
    record?.capture.source.sentence.slice(record.capture.source.start, record.capture.source.end) ??
    t('读取中…');
  return (
    <Modal title="record-title" close={close}>
      <div class="detail-heading">
        <h2 id="record-title">{term}</h2>
        <button class="quiet" aria-label={t('关闭详情')} onClick={close}>
          ✕
        </button>
      </div>
      {error && (
        <p class="error" role="alert">
          {t(error)}
        </p>
      )}
      {editing ? (
        <div class="detail-editor">
          <label>
            {t('简短释义')}{' '}
            <textarea
              value={editing.gloss}
              onInput={(e) => setEditing({ ...editing, gloss: e.currentTarget.value })}
            />
          </label>
          {editing.examples.map((example, index) => (
            <div class="mt-4" key={index}>
              <label>
                {t('例句')} {index + 1}
                <textarea
                  value={example.text}
                  onInput={(e) =>
                    setEditing({
                      ...editing,
                      examples: editing.examples.map((item, i) =>
                        i === index ? { ...item, text: e.currentTarget.value } : item,
                      ),
                    })
                  }
                />
              </label>
              <label class="mt-2">
                {t('挖空表达')}{' '}
                <input
                  value={example.target}
                  onInput={(e) =>
                    setEditing({
                      ...editing,
                      examples: editing.examples.map((item, i) =>
                        i === index ? { ...item, target: e.currentTarget.value } : item,
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}
          <div class="detail-actions">
            <button onClick={() => setEditing(undefined)}>{t('取消编辑')}</button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await send({ type: 'edit', data: { id: entry!.id, material: editing } });
                  setEditing(undefined);
                })
              }
            >
              {t('保存')}{' '}
            </button>
          </div>
        </div>
      ) : deleting ? (
        <div>
          <p>{t('删除这条学习记录？')}</p>
          {entry && (
            <label class="my-4">
              <input
                type="checkbox"
                checked={deleteAnki}
                onChange={(e) => setDeleteAnki(e.currentTarget.checked)}
              />{' '}
              {t('同时删除 Anki 笔记')}{' '}
            </label>
          )}
          <p class="muted">{deleteAnki ? t('将删除关联笔记及复习历史。') : t('Anki 笔记会保留。')}</p>
          <div class="detail-actions">
            <button onClick={() => setDeleting(false)}>{t('取消删除')}</button>
            <button
              class="danger"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (entry) await send({ type: 'remove', data: { id: entry.id, anki: deleteAnki } });
                  else await send({ type: 'removeSource', data: record!.capture.id });
                  close();
                })
              }
            >
              {t('确认删除')}{' '}
            </button>
          </div>
        </div>
      ) : (
        <>
          {material && (
            <>
              <p class="muted">{material.gloss}</p>
              <Examples material={material} numbered />
            </>
          )}
          {!!detail?.sources.length && (
            <details class="mt-4">
              <summary>{t('原文与来源')}</summary>
              {detail.sources.map((c) => (
                <div class="mt-4" key={c.id}>
                  <p class="source">{c.source.sentence.replace(/\s+/gu, ' ').trim()}</p>
                  <div class="source-actions">
                    <a href={c.source.url} target="_blank" rel="noreferrer">
                      {c.source.title || new URL(c.source.url).hostname}
                    </a>
                    <button
                      class="quiet"
                      onClick={() => {
                        if (confirm(t('删除这条来源？学习材料与 Anki 笔记会保留。')))
                          void act(() => send({ type: 'removeSource', data: c.id }));
                      }}
                    >
                      {t('移除来源')}{' '}
                    </button>
                  </div>
                </div>
              ))}
              {(sourcePage > 0 || detail.moreSources) && (
                <div class="detail-actions">
                  <button disabled={!sourcePage} onClick={() => setSourcePage(sourcePage - 1)}>
                    {t('上一组来源')}{' '}
                  </button>
                  <button disabled={!detail.moreSources} onClick={() => setSourcePage(sourcePage + 1)}>
                    {t('下一组来源')}{' '}
                  </button>
                </div>
              )}
            </details>
          )}
          <p class={`detail-status ${record?.job?.error ? 'error' : 'muted'}`} role="status">
            {(record?.job?.error && t(record.job.error)) ||
              (record?.job
                ? material
                  ? t('等待 Anki')
                  : t('正在生成例句…')
                : entry?.noteId
                  ? t('已保存到 Anki')
                  : '')}
          </p>
          <div class="detail-actions">
            {entry && (
              <button
                aria-pressed={record?.state === 'known'}
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    send({
                      type: 'state',
                      data: {
                        id: vocabularyId(entry.language, entry.lemma),
                        state: record?.state === 'known' ? 'learning' : 'known',
                      },
                    }),
                  )
                }
              >
                {record?.state === 'known' ? t('恢复学习') : t('认识了')}
              </button>
            )}
            {material && <button onClick={() => setEditing(structuredClone(material))}>{t('编辑')}</button>}
            {record?.job?.error && (
              <button
                disabled={busy}
                onClick={() => void act(() => send({ type: 'retry', data: record.job!.id }))}
              >
                {t('重试')}{' '}
              </button>
            )}
            {record && (
              <button
                class="danger"
                onClick={() => {
                  setDeleting(true);
                  setDeleteAnki(false);
                }}
              >
                {t('删除')}{' '}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
