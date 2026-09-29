import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
test('reloading the actual extension shuts down old page observers without uncaught exceptions', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<body><p style="font:22px/2 sans-serif">Reading together makes learning easier.</p></body>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const extension = resolve('.output/chrome-mv3');
  const c = await chromium.launchPersistentContext('', {
    executablePath: process.env.TAPGLOSS_TEST_BROWSER,
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = c.serviceWorkers()[0] ?? (await c.waitForEvent('serviceworker'));
    const page = await c.newPage();
    const errors: string[] = [];
    const session = await c.newCDPSession(page);
    await session.send('Runtime.enable');
    session.on('Runtime.exceptionThrown', (event) =>
      errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text),
    );
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await expect(page.locator('tap-gloss')).toHaveCount(1);
    await worker
      .evaluate(() => {
        (globalThis as unknown as { chrome: { runtime: { reload: () => void } } }).chrome.runtime.reload();
      })
      .catch(() => {});
    await page.mouse.move(30, 30);
    await page.locator('p').click();
    await expect(page.locator('tap-gloss')).toHaveCount(0);
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.textContent = 'More text after reload.';
      document.body.append(p);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1200);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
