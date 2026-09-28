import { test, expect, chromium, type Page, type BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { startSyncServer } from '../sync-servers';
import { fakeServices, source } from '../fixtures';
import type { Request } from '../../src/messages';

async function rpc(page: Page, message: Request) {
  return page.evaluate((request) => {
    const scope = globalThis as unknown as {
      chrome: {
        runtime: { sendMessage: (r: unknown) => Promise<{ ok: boolean; data: unknown; error?: string }> };
      };
    };
    return scope.chrome.runtime.sendMessage(request);
  }, message);
}

for (const backend of ['s3', 'webdav'] as const) {
  test(`two isolated browsers sync via ${backend} without duplicating Anki notes`, async () => {
    test.setTimeout(60000);
    const remote = await startSyncServer(backend);
    const services = fakeServices();
    const api = createServer(async (req, res) => {
      let body = '';
      for await (const part of req) body += part;
      const response = await services.fetcher(`http://localhost${req.url}`, { body });
      res.setHeader('Content-Type', 'application/json');
      res.end(await response.text());
    });
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
    const address = api.address();
    if (!address || typeof address === 'string') throw new Error('No API server');
    const origin = `http://127.0.0.1:${address.port}`;
    const contexts: BrowserContext[] = [];
    try {
      const pages: Page[] = [];
      for (let i = 0; i < 2; i++) {
        const extension = resolve('.output/chrome-mv3');
        const context = await chromium.launchPersistentContext('', {
          executablePath: process.env.TAPGLOSS_TEST_BROWSER,
          channel: 'chromium',
          locale: 'zh-CN',
          headless: true,
          args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
          viewport: { width: 1440, height: 1050 },
          colorScheme: 'dark',
        });
        contexts.push(context);
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        const page = await context.newPage();
        await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
        await page.getByLabel('API 地址', { exact: true }).fill(origin);
        await page.getByLabel('API Key', { exact: true }).fill('test-only');
        await page.getByLabel('AnkiConnect 地址', { exact: true }).fill(origin + '/anki');
        await page.getByLabel('存储方式', { exact: true }).click();
        await page.getByRole('option', { name: backend === 's3' ? 'S3' : 'WebDAV', exact: true }).click();
        await page
          .getByLabel(backend === 's3' ? 'S3 地址' : 'WebDAV 地址', { exact: true })
          .fill(remote.config.endpoint);
        if (backend === 's3') await page.getByLabel('存储桶', { exact: true }).fill(remote.config.bucket);
        await page
          .getByLabel(backend === 's3' ? 'Access Key ID' : '用户名', { exact: true })
          .fill(remote.config.username);
        await page
          .getByLabel(backend === 's3' ? 'Secret Access Key' : '密码', { exact: true })
          .fill(remote.config.password);
        await expect(page.getByRole('button', { name: '立即同步', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: '测试同步连接', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: /^连接正常$/ })).toBeVisible();
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveAttribute(
          'title',
          '已保存',
        );
        pages.push(page);
      }
      const [a, b] = pages as [Page, Page];
      const capture = await rpc(a, { type: 'lookup', data: source });
      expect(capture.ok).toBe(true);
      await expect.poll(() => services.counts().adds).toBe(1);
      for (const page of [a, b]) {
        await page.getByRole('button', { name: '立即同步', exact: true }).click();
        await expect(page.getByText(/^上次同步 /)).toBeVisible();
      }
      const list = await rpc(b, { type: 'list' });
      expect(list).toMatchObject({ ok: true, data: { records: [{ term: 'reluctant', exported: false }] } });
      expect(services.counts()).toEqual({ generations: 1, adds: 1 });
      await b.screenshot({ path: `test-results/sync-${backend}-settings.png`, fullPage: true });
      await b.setViewportSize({ width: 390, height: 844 });
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await b.screenshot({ path: `test-results/sync-${backend}-narrow.png`, fullPage: true });
      await b.getByRole('button', { name: '记录', exact: true }).click();
      await expect(b.getByText('reluctant', { exact: true }).first()).toBeVisible();
      await rpc(b, { type: 'state', data: { id: 'en:reluctant', state: 'known' } });
      expect((await rpc(b, { type: 'syncNow' })).ok).toBe(true);
      expect((await rpc(a, { type: 'syncNow' })).ok).toBe(true);
      expect(await rpc(a, { type: 'vocabulary', data: ['reluctant'] })).toMatchObject({
        data: [{ state: 'known' }],
      });
      expect(services.counts().adds).toBe(1);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
      await remote.close();
      await new Promise<void>((r) => api.close(() => r()));
    }
  });
}
