import { useEffect, useState } from 'preact/hooks';
import { send, subscribeChanges } from '../messages';
import { useI18n } from './i18n';
export function DisabledSites() {
  const t = useI18n();
  const [sites, setSites] = useState<string[]>([]),
    [error, setError] = useState('');
  useEffect(
    () =>
      subscribeChanges((change) => {
        if (change.initial || change.settings)
          void send({ type: 'readingControls' })
            .then((value) => setSites(value.disabledSites))
            .catch(() => setError(t('读取失败')));
      }),
    [],
  );
  if (!sites.length && !error) return null;
  return (
    <details>
      <summary>{t('已停用的网站')}</summary>
      <div class="language-tags">
        {sites.map((host) => (
          <button
            type="button"
            key={host}
            title={t('恢复启用')}
            onClick={() =>
              void send({ type: 'changeReadingControls', data: { hostname: host, siteEnabled: true } }).catch(
                () => setError(t('操作未完成')),
              )
            }
          >
            {host}
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
