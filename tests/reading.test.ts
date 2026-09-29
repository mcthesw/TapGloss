import { expect, it } from 'vitest';
import { readingControlsSchema, readingEnabled, siteHostname } from '../src/domain/reading';
it('separates the global switch from exact host preferences', () => {
  const preferences = readingControlsSchema.parse({ disabledSites: ['example.org'] });
  expect(readingEnabled(preferences, 'https://example.org/page')).toBe(false);
  expect(readingEnabled(preferences, 'http://example.org:8080/other')).toBe(false);
  expect(readingEnabled(preferences, 'https://docs.example.org/')).toBe(true);
  expect(readingEnabled({ ...preferences, enabled: false }, 'https://docs.example.org/')).toBe(false);
  expect(siteHostname('https://EXAMPLE.org/test')).toBe('example.org');
  expect(siteHostname('chrome://extensions')).toBeUndefined();
});
