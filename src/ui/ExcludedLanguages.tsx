import { useI18n } from './i18n';
import { LocaleContext } from './i18n';
import { useContext } from 'preact/hooks';
import { languageCodes, type LanguageCode } from '../domain/languages';
import { Select } from './Select';

export function ExcludedLanguages({
  value,
  change,
}: {
  value: LanguageCode[];
  change: (value: LanguageCode[]) => void;
}) {
  const t = useI18n();
  const names = new Intl.DisplayNames([useContext(LocaleContext)], { type: 'language' });
  return (
    <div class="excluded-languages">
      <Select
        label={t('忽略语言')}
        value=""
        options={[
          { value: '', label: t('添加语言…') },
          ...languageCodes
            .filter((code) => !value.includes(code))
            .map((code) => ({ value: code, label: names.of(code) ?? code })),
        ]}
        change={(code) => {
          if (code) change([...value, code as LanguageCode]);
        }}
      />
      {!!value.length && (
        <div class="language-tags">
          {value.map((code) => (
            <button
              type="button"
              key={code}
              aria-label={t('移除{0}', names.of(code))}
              onClick={() => change(value.filter((language) => language !== code))}
            >
              {names.of(code)} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
