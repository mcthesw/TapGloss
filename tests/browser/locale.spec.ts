import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'node:path';

test('automatic locale follows the browser and import errors are translated', async () => {
  const extension = resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    executablePath: process.env.TAPGLOSS_TEST_BROWSER,
    channel: 'chromium',
    headless: true,
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByLabel('Interface language', { exact: true })).toHaveValue('Automatic');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addStyleTag({ content: ':root { font-family: Arial, sans-serif; font-size: 18px; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Wordlists', exact: true }).click();
    await page
      .getByLabel('Choose a wordlist file')
      .setInputFiles({ name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('"unclosed') });
    await expect(page.getByRole('alert')).toHaveText('Invalid file format. Check quotes and delimiters.');
    await page
      .getByLabel('Choose a wordlist file')
      .setInputFiles({ name: 'Words.txt', mimeType: 'text/plain', buffer: Buffer.from('apple\nbook') });
    await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toBeFocused();
    await page.screenshot({ path: 'test-results/wordlist-import-english-narrow.png', fullPage: true });
  } finally {
    await context.close();
  }
});
