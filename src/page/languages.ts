import { detectAll } from 'tinyld/light';
import { textNodes } from './selection';

const scripts: Record<string, RegExp> = {
  zh: /^\p{Script=Han}+$/u,
  ja: /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u,
  ko: /^[\p{Script=Hangul}\p{Script=Han}]+$/u,
  ru: /^\p{Script=Cyrillic}+$/u,
  ar: /^\p{Script=Arabic}+$/u,
  he: /^\p{Script=Hebrew}+$/u,
  hi: /^\p{Script=Devanagari}+$/u,
  bn: /^\p{Script=Bengali}+$/u,
  th: /^\p{Script=Thai}+$/u,
  el: /^\p{Script=Greek}+$/u,
};
const latin = /^\p{Script=Latin}+$/u;
export function identifyLanguage(text: string): string | undefined {
  if ((text.match(/\p{L}/gu)?.length ?? 0) < 4) return;
  const [best, second] = detectAll(text);
  if (best && best.accuracy >= 0.5 && best.accuracy - (second?.accuracy ?? 0) >= 0.2) return best.lang;
}

export function isExcludedLanguage(
  word: string,
  detected: string | undefined,
  hint: string,
  excluded: readonly string[],
  context = '',
) {
  const letters = word.normalize('NFC').replace(/[^\p{L}]/gu, '');
  const declared = hint.toLowerCase().split(/[-_]/)[0];
  // Han-only fragments are ambiguous between Chinese and Japanese; use an authored hint.
  const han = scripts.zh!.test(letters);
  const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(context);
  const korean = /\p{Script=Hangul}/u.test(context);
  const language =
    han && (declared === 'ja' || japanese)
      ? 'ja'
      : han && (declared === 'ko' || korean)
        ? 'ko'
        : han && !detected && context.trim()
          ? 'zh'
          : (detected ?? declared);
  return !!language && excluded.includes(language) && (scripts[language] ?? latin).test(letters);
}

export function languageFilter(excluded: readonly string[]) {
  const contexts = new WeakMap<Element, { offsets: Map<Node, number>; sentences: Intl.SegmentData[] }>();
  const cache = new Map<string, string | undefined>();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  return (node: Text, word: string, offset: number) => {
    if (!excluded.length) return false;
    const block =
      node.parentElement?.closest('p,li,blockquote,h1,h2,h3,h4,td,article,section,div') ?? document.body;
    let context = contexts.get(block);
    if (!context) {
      let text = '';
      const offsets = new Map<Node, number>();
      for (const part of textNodes(block)) {
        offsets.set(part, text.length);
        text += part.data;
      }
      context = { offsets, sentences: [...segmenter.segment(text)] };
      contexts.set(block, context);
    }
    const position = (context.offsets.get(node) ?? 0) + offset;
    const sentence = context.sentences.find(
      (s) => s.index <= position && s.index + s.segment.length > position,
    );
    const relative = position - (sentence?.index ?? 0);
    const start = Math.max(0, Math.floor(relative / 400) * 400 - 100);
    const whole = sentence?.segment ?? node.data;
    // Chat nicknames and messages often share one block but are separate language contexts.
    const colon = Math.max(whole.lastIndexOf(':', relative), whole.lastIndexOf('：', relative));
    const end = [
      whole.indexOf(':', relative + word.length),
      whole.indexOf('：', relative + word.length),
    ].filter((i) => i >= 0);
    const fragment = whole.slice(colon + 1, end.length ? Math.min(...end) : undefined);
    const text = colon >= 0 || end.length ? fragment.slice(0, 600) : whole.slice(start, start + 600);
    if (!cache.has(text)) cache.set(text, identifyLanguage(text));
    const hint = node.parentElement?.closest('[lang]')?.getAttribute('lang') ?? '';
    return isExcludedLanguage(word, cache.get(text), hint, excluded, text);
  };
}
