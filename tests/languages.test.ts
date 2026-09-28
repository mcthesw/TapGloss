import { describe, expect, it } from 'vitest';
import { identifyLanguage, isExcludedLanguage } from '../src/page/languages';
import { settingsSchema } from '../src/domain/model';

describe('local language exclusions', () => {
  const excluded = (sentence: string, word: string, languages: string[], hint = '') =>
    isExcludedLanguage(word, identifyLanguage(sentence), hint, languages);
  it('does not change behavior without an exclusion', () => {
    expect(settingsSchema.parse({}).excludedLanguages).toEqual([]);
    expect(excluded('这是用来阅读的中文句子。', '阅读', [])).toBe(false);
  });
  it('recognizes Chinese in context, including traditional characters', () => {
    expect(excluded('这是用来阅读的中文句子。', '阅读', ['zh'])).toBe(true);
    expect(excluded('這是一個用來閱讀的中文句子。', '閱讀', ['zh'])).toBe(true);
  });
  it('keeps embedded English queryable in Chinese context', () => {
    expect(excluded('这篇文章解释了 repository 的含义。', 'repository', ['zh'])).toBe(false);
  });
  it('does not suppress Japanese Han words when Chinese is excluded', () => {
    expect(excluded('これは漢字を含む日本語です。', '漢字', ['zh'])).toBe(false);
    expect(excluded('東京大学', '東京', ['zh'], 'ja')).toBe(false);
  });
  it('uses sentence context instead of guessing the isolated English word', () => {
    expect(excluded('She was reluctant to ask for help.', 'reluctant', ['en'])).toBe(true);
    expect(excluded('repository', 'repository', ['zh', 'en'])).toBe(false);
    expect(excluded('123 !!!', '123', ['en'], 'en')).toBe(false);
  });
  it('uses language tags only as a fallback, without overriding clear text evidence', () => {
    expect(excluded('Hello', 'Hello', ['en'], 'en-US')).toBe(true);
    expect(excluded('这是用来阅读的中文句子。', '阅读', ['en'], 'en')).toBe(false);
    expect(excluded('She was reluctant to ask for help.', 'reluctant', ['zh'], 'zh-CN')).toBe(false);
  });
});
