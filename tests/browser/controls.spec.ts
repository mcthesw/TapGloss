import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

test('toolbar controls stop and resume live pages; built-in downloads are explicit and deduplicated', async () => {
  test.setTimeout(45000);
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(
      '<html><body style="font:24px/2 system-ui;padding:40px"><p>Books bring people together.</p></body></html>',
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const extension = resolve('.output/chrome-mv3');
  const c = await chromium.launchPersistentContext('', {
    executablePath: process.env.TAPGLOSS_TEST_BROWSER,
    channel: 'chromium',
    headless: true,
    locale: 'zh-CN',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = c.serviceWorkers()[0] ?? (await c.waitForEvent('serviceworker'));
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const reading = await c.newPage();
    await reading.goto(`http://127.0.0.1:${port}`);
    const count = () =>
      reading.evaluate(
        () =>
          [
            ...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('tapgloss-new') ??
              []),
          ].length,
      );
    await expect.poll(count).toBeGreaterThan(0);
    const other = await c.newPage();
    await other.goto(`http://localhost:${port}`);
    const otherCount = () =>
      other.evaluate(
        () =>
          [
            ...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('tapgloss-new') ??
              []),
          ].length,
      );
    await expect.poll(otherCount).toBeGreaterThan(0);
    await reading.bringToFront();
    const created = c.waitForEvent('page');
    await worker.evaluate(async (url) => {
      await (
        globalThis as unknown as {
          chrome: { tabs: { create: (options: { url: string; active: boolean }) => Promise<unknown> } };
        }
      ).chrome.tabs.create({ url, active: false });
    }, base + '/popup.html');
    const popup = await created;
    await popup.waitForLoadState();
    await expect(popup.locator('link[rel="modulepreload"]')).toHaveCount(0);
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.reload();
    await expect(popup.getByRole('button', { name: '开启', exact: true })).toBeEnabled();
    await expect(popup.getByRole('button', { name: '在此网站启用' })).toBeEnabled();
    await expect
      .poll(() =>
        popup
          .locator('.toggle-track')
          .first()
          .evaluate((el) => getComputedStyle(el, '::after').transform),
      )
      .toBe('matrix(1, 0, 0, 1, 12, 0)');
    const checkAlignment = async () => {
      const positions = await popup
        .locator('.toggle-track')
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left));
      expect(positions).toHaveLength(2);
      expect(Math.abs(positions[0]! - positions[1]!)).toBeLessThan(0.5);
    };
    await checkAlignment();
    await popup.locator('.quick-panel').screenshot({ path: 'test-results/toolbar.png' });
    await expect(popup.locator('.quick-panel')).toHaveCSS('background-color', 'rgb(36, 36, 36)');
    await popup.getByRole('button', { name: '开启', exact: true }).click();
    await checkAlignment();
    await expect.poll(count).toBe(0);
    await expect.poll(otherCount).toBe(0);
    await reading.reload();
    await expect(reading.locator('tap-gloss')).toHaveCount(1);
    expect(await count()).toBe(0);
    await popup.getByRole('button', { name: '已暂停', exact: true }).click();
    await expect.poll(count).toBeGreaterThan(0);
    await popup.getByRole('button', { name: '在此网站启用' }).click();
    await expect.poll(count).toBe(0);
    await expect.poll(otherCount).toBeGreaterThan(0);
    await popup.getByRole('button', { name: '开启', exact: true }).click();
    await popup.getByRole('button', { name: '已暂停', exact: true }).click();
    expect(await count()).toBe(0);
    await popup.getByRole('button', { name: '在此网站启用' }).click();
    await expect.poll(count).toBeGreaterThan(0);
    let requests = 0;
    const data = readFileSync('resources/wordlists/cet4.txt', 'utf8');
    await worker.evaluate((text) => {
      const scope = globalThis as unknown as { downloads: number; fetch: typeof fetch };
      scope.downloads = 0;
      const original = fetch;
      scope.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/cet4.txt')) {
          scope.downloads++;
          return Promise.resolve(new Response(text));
        }
        return original(input, init);
      };
    }, data);
    const options = await c.newPage();
    await options.goto(base + '/options.html#wordlists');
    await options.getByRole('button', { name: '添加词表', exact: true }).click();
    requests = await worker.evaluate(() => (globalThis as unknown as { downloads: number }).downloads);
    expect(requests).toBe(0);
    const row = options.locator('.builtin-row').filter({ hasText: 'CET-4' });
    await row.getByRole('button', { name: '添加', exact: true }).click();
    await expect(row.getByRole('button', { name: '已添加' })).toBeDisabled();
    expect(await worker.evaluate(() => (globalThis as unknown as { downloads: number }).downloads)).toBe(1);
    await options.screenshot({ path: 'test-results/builtin-wordlists.png' });
    await options.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(options.getByRole('heading', { name: 'CET-4', exact: true })).toBeVisible();
    await options.getByRole('button', { name: '添加词表', exact: true }).click();
    await expect(row.getByRole('button', { name: '已添加' })).toBeDisabled();
    expect(await worker.evaluate(() => (globalThis as unknown as { downloads: number }).downloads)).toBe(1);
    await options.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await options.getByRole('button', { name: '设置', exact: true }).click();
    await options.getByLabel('界面语言', { exact: true }).click();
    await options.getByRole('option', { name: 'English', exact: true }).click();
    await options.getByRole('button', { name: '保存', exact: true }).click();
    await reading.bringToFront();
    await popup.reload();
    await expect(popup.getByRole('button', { name: 'On', exact: true })).toBeEnabled();
    await expect(popup.getByRole('button', { name: 'Enable on this site' })).toBeEnabled();
    await checkAlignment();
    await popup.locator('.quick-host').evaluate((el) => {
      el.textContent = 'a-very-long-subdomain.example.org';
    });
    await checkAlignment();
    await popup.locator('.quick-panel').screenshot({ path: 'test-results/toolbar-english-long-host.png' });
  } finally {
    await c.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
