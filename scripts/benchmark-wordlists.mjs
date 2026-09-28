/* global process, console, URL, performance, chrome, document, Buffer */
// Isolated browser and synthetic UTF-8 file. No model, Anki or cloud connection.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const count = Number(process.argv[2] ?? 100000);
if (!Number.isInteger(count) || count < 100 || count > 100000) throw new Error('Expected 100..100000');
const extension = resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext('', {
  executablePath: process.env.TAPGLOSS_TEST_BROWSER,
  channel: 'chromium',
  headless: true,
  locale: 'zh-CN',
  viewport: { width: 1280, height: 900 },
  colorScheme: 'dark',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  await page.getByRole('button', { name: '词表', exact: true }).click();
  const words = Array.from({ length: count }, (_, i) => `word${String(i).padStart(6, '0')}`);
  let started = performance.now();
  await page
    .getByLabel('选择词表文件')
    .setInputFiles({ name: 'Large.txt', mimeType: 'text/plain', buffer: Buffer.from(words.join('\n')) });
  await page.getByRole('dialog').getByLabel('名称', { exact: true }).waitFor();
  const previewMs = Math.round(performance.now() - started);
  started = performance.now();
  await page.getByRole('dialog').getByRole('button', { name: '导入', exact: true }).click();
  await page.getByRole('heading', { name: 'Large', exact: true }).waitFor({ timeout: 120000 });
  const importMs = Math.round(performance.now() - started);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const sample = await page.evaluate(
      async (forms) => {
        const started = performance.now();
        const result = await chrome.runtime.sendMessage({ type: 'readingWords', data: forms });
        if (!result.ok || result.data.length !== forms.length || result.data.some((w) => !w.suppressed))
          throw new Error('Baseline lookup mismatch');
        return {
          elapsedMs: Math.round(performance.now() - started),
          bytes: JSON.stringify(result.data).length,
        };
      },
      words.slice(count - 500),
    );
    samples.push(sample);
  }
  const metadata = await page.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'wordlists' });
    return {
      count: result.data[0].count,
      bytes: JSON.stringify(result.data).length,
      domNodes: document.querySelectorAll('*').length,
    };
  });
  if (metadata.count !== count || metadata.bytes > 1000) throw new Error('Unbounded wordlist response');
  await mkdir('.output/wordlist-performance', { recursive: true });
  await page.screenshot({ path: '.output/wordlist-performance/list.png', fullPage: true });
  const result = {
    count,
    environment: 'Chromium IndexedDB with synthetic wordlist',
    previewMs,
    importMs,
    samples,
    metadata,
  };
  await writeFile(`.output/wordlist-performance/${count}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const page = context.pages().at(-1);
  console.log((await page?.locator('body').innerText())?.slice(0, 1000));
  throw error;
} finally {
  await context.close();
}
