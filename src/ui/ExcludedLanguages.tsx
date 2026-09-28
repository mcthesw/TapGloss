import { languageCodes, type LanguageCode } from '../domain/languages';
import { Select } from './Select';

const names = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
export function ExcludedLanguages({
  value,
  change,
}: {
  value: LanguageCode[];
  change: (value: LanguageCode[]) => void;
}) {
  return (
    <div class="excluded-languages">
      <Select
        label="忽略语言"
        value=""
        options={[
          { value: '', label: '添加语言…' },
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
              aria-label={`移除${names.of(code)}`}
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
