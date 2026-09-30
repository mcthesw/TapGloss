import { useRef, useState } from 'preact/hooks';
import { Database } from '../storage/database';
import { exportBackup, inspectBackup, restoreBackup } from '../backup/service';
import type { BackupFile } from '../backup/file';
import { send } from '../messages';
import { useI18n } from './i18n';
import { Help } from './Help';
import { Modal } from './Modal';

export function Backup() {
  const t = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<BackupFile>();
  const [progress, setProgress] = useState(0);
  const run = async <T,>(action: (db: Database) => Promise<T>) => {
    setBusy(true);
    setProgress(0);
    setError('');
    setNotice('');
    const db = new Database();
    try {
      return await action(db);
    } catch (e) {
      setError(t(e instanceof Error ? e.message : '操作未完成'));
    } finally {
      db.close();
      setBusy(false);
    }
  };
  return (
    <section class="paper space-y-5">
      <div class="settings-heading">
        <h2>{t('备份')}</h2>
        <Help label={t('备份帮助')}>
          {t(
            '保存学习记录、词表和 Anki 关联，不含密钥、连接设置或 Anki 复习历史。恢复会合并到现有数据，不直接调用 AI 或 Anki。',
          )}
        </Help>
      </div>
      <div class="detail-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async (db) => {
              const file = await exportBackup(db, setProgress);
              const url = URL.createObjectURL(file);
              const link = document.createElement('a');
              link.href = url;
              link.download = `TapGloss-${new Date().toISOString().replace(/[:.]/g, '-')}.tapgloss`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
              setNotice(t('备份已导出'));
            })
          }
        >
          {t('导出备份')}
        </button>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          {t('恢复备份')}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".tapgloss"
        hidden
        aria-label={t('选择备份文件')}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file)
            void run(() => inspectBackup(file, setProgress)).then((backup) => {
              if (backup) setPending(backup);
            });
        }}
      />
      {busy && !pending && (
        <p class="muted" role="status">
          {t('正在处理…')} {Math.round(progress * 100)}%
        </p>
      )}
      {notice && (
        <p class="muted" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <Modal
          title={t('恢复备份')}
          close={() => {
            if (!busy) setPending(undefined);
          }}
        >
          <h2 id={t('恢复备份')}>{t('恢复备份')}</h2>
          <p>{t('{0} 条记录 · {1} 份词表', pending.header.records, pending.header.wordlists)}</p>
          <p class="muted">{t('合并到现有数据，保留已有记录。')}</p>
          <div class="detail-actions">
            <button type="button" disabled={busy} onClick={() => setPending(undefined)}>
              {t('取消')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async (db) => {
                  await restoreBackup(db, pending, setProgress);
                  await send({ type: 'backupRestored' }).catch(() => {});
                  setPending(undefined);
                  setNotice(t('恢复完成'));
                })
              }
            >
              {t('确认恢复')}
            </button>
          </div>
          {busy && (
            <p class="muted" role="status">
              {t('正在处理…')} {Math.round(progress * 100)}%
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}
