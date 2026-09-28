import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { english } from './english';

export type Locale = 'zh' | 'en';
export function resolveLocale(
  value: 'auto' | Locale,
  browserLanguage = globalThis.navigator?.language ?? 'en',
): Locale {
  return value === 'auto' ? (browserLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en') : value;
}
export const LocaleContext = createContext<Locale>(resolveLocale('auto'));
export function translate(text: string, locale: Locale, ...values: (string | number | undefined)[]) {
  let template = locale === 'en' ? (english[text] ?? text) : text;
  if (locale === 'en' && !english[text]) {
    template = text.replace(
      /^同步服务返回 (\d+)，请检查地址与存储配置$/,
      'Sync returned $1. Check the endpoint and storage settings.',
    );
    template = template
      .replace(/^已获取 (\d+) 个模型$/, '$1 models found')
      .replace(/^连接正常 · 例句生成通过（([\d.]+) 秒）$/, 'Connected · Examples generated ($1 s)');
    template = template
      .replace(
        /^无法获取模型（(\d+)），可在连接选项中填写模型名称$/,
        'Could not fetch models ($1). Enter a model name manually.',
      )
      .replace(/^模型请求失败（(\d+)）$/, 'Model request failed ($1)')
      .replace(/^Anki请求失败（(\d+)）$/, 'Anki request failed ($1)');
  }
  return values.length
    ? template.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ''))
    : template;
}
export function useI18n() {
  const locale = useContext(LocaleContext);
  return (text: string, ...values: (string | number | undefined)[]) => translate(text, locale, ...values);
}
