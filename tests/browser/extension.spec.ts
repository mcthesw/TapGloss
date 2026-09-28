import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fakeServices } from '../fixtures';
import { defaultPrompt } from '../../src/explain/prompt';
import { cardStyle } from '../../src/anki/template';

let context: BrowserContext, server: Server, origin: string, options: Page, extensionId: string;
const services = fakeServices();
const failModels = false,
  failGeneration = false;
let lastPrompt = '',
  modelRequests = 0,
  holdModels = false,
  modelAborts = 0;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.url === '/languages') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<!doctype html><html lang="en"><body style="font:22px/2 system-ui;margin:60px"><p>这是一个用来<em id="chinese">阅读</em>的中文句子。</p><p>这篇文章解释了 <em id="english">repository</em> 的含义。</p><p lang="ja">これは<em id="japanese">漢字</em>を含む日本語です。</p></body></html>',
      );
      return;
    }
    if (req.url === '/reading' || req.url === '/other') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<!doctype html><html><head><title>A quiet afternoon</title><style>body{font:21px/1.9 Georgia;margin:80px auto;max-width:700px;background:#f6f4ef;color:#293d34}h1{font-size:42px}p{margin:30px 0}</style></head><body><h1>A quiet afternoon</h1><p>She was <em>reluctant</em> to ask for help.</p><p>Outside, the rain had stopped. The garden was quiet again.</p><a href="/other">Continue reading</a></body></html>',
      );
      return;
    }
    if (req.url === '/models') {
      modelRequests++;
      if (holdModels) {
        const timer = setTimeout(() => res.end(JSON.stringify({ data: [{ id: 'late-model' }] })), 10000);
        res.on('close', () => {
          clearTimeout(timer);
          if (!res.writableEnded) modelAborts++;
        });
        return;
      }
      if (failModels) {
        res.statusCode = 503;
        res.end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'test-model' }, { id: 'second-model' }] }));
      return;
    }
    let body = '';
    for await (const part of req) body += part;
    if (req.url === '/chat/completions') {
      lastPrompt = JSON.parse(body).messages[0].content;
      if (failGeneration) {
        res.statusCode = 401;
        res.end('{}');
        return;
      }
    }
    try {
      const response = await services.fetcher(`${origin}${req.url}`, { body });
      res.setHeader('content-type', 'application/json');
      res.end(await response.text());
    } catch {
      res.statusCode = 503;
      res.end('{}');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server');
  origin = `http://127.0.0.1:${address.port}`;
  const extension = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.TAPGLOSS_TEST_BROWSER,
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel('API 地址', { exact: true }).fill(origin);
  await options.getByLabel('API Key', { exact: true }).fill('test-only');
  await options.getByLabel('模型', { exact: true }).fill('test-model');
  await options.getByLabel('AnkiConnect 地址', { exact: true }).fill(`${origin}/anki`);
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect(options.getByRole('button', { name: '保存', exact: true })).toHaveAttribute('title', '已保存');
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((done) => server?.close(() => done()));
});

test('network actions are explicit, drafts survive tabs, and saving does not fetch models', async () => {
  await options.waitForTimeout(1100);
  expect(modelRequests).toBe(0);
  await options.getByRole('button', { name: '获取模型', exact: true }).click();
  await expect(options.getByText('已获取 2 个模型')).toBeVisible();
  await options.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(options.getByRole('listbox', { name: '可用模型' }).getByRole('option')).toHaveCount(2);
  await options.getByRole('option', { name: 'second-model', exact: true }).click();
  await options.getByRole('button', { name: '获取模型', exact: true }).click();
  await expect(options.getByText('已获取 2 个模型')).toBeVisible();
  await expect(options.getByLabel('模型', { exact: true })).toHaveValue('second-model');
  await options.getByText('生成提示词', { exact: true }).click();
  const prompt = options.getByLabel('提示词', { exact: true });
  await prompt.fill(`${defaultPrompt}\nPrefer everyday examples.`);
  await options.getByRole('button', { name: '记录', exact: true }).click();
  await options.getByRole('button', { name: '设置', exact: true }).click();
  await expect(prompt).toHaveValue(`${defaultPrompt}\nPrefer everyday examples.`);
  expect(modelRequests).toBe(2);
  await options.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(options.getByRole('status').filter({ hasText: '连接正常' })).toBeVisible();
  expect(lastPrompt).toContain('Prefer everyday examples.');
  expect(services.notes.size).toBe(0);
  await options.getByRole('button', { name: '恢复默认提示词' }).click();
  await options.getByLabel('模型', { exact: true }).fill('test-model');
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect(options.getByRole('button', { name: '保存', exact: true })).toHaveAttribute('title', '已保存');
  expect(modelRequests).toBe(2);
  await options.getByRole('button', { name: '测试 Anki 连接', exact: true }).click();
  await expect(options.getByRole('status').filter({ hasText: 'Anki 连接正常' })).toBeVisible();
  await options.getByText('生成提示词', { exact: true }).click();
  await options.emulateMedia({ colorScheme: 'dark' });
  await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('lookup saves once, stops polling, and broadcasts known state to another page', async () => {
  const page = await context.newPage(),
    other = await context.newPage();
  await page.goto(`${origin}/reading`);
  await other.goto(`${origin}/reading`);
  await page.locator('tap-gloss').waitFor({ state: 'attached' });
  await page.locator('em').click();
  const popup = page.getByRole('dialog', { name: '语境查询' });
  await expect(popup.getByRole('status')).toHaveText('已保存到 Anki');
  await expect(popup.locator('.example')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/lookup.png' });
  const before = services.counts();
  await popup.getByRole('button', { name: '认识了', exact: true }).click();
  await expect(popup.getByRole('button', { name: '恢复学习' })).toBeVisible();
  await expect
    .poll(() =>
      other.locator('em').evaluate((el) => {
        const css = CSS as typeof CSS & { highlights: Map<string, Set<Range>> };
        return [...(css.highlights.get('tapgloss-learning') ?? [])].some((r) =>
          el.contains(r.startContainer),
        );
      }),
    )
    .toBe(false);
  await other.locator('em').click();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.locator('tap-gloss').waitFor({ state: 'attached' });
  await page.locator('em').evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el.firstChild!);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
  });
  await page.keyboard.press('Alt+q');
  await expect(popup.getByRole('status')).toHaveText('已保存到 Anki');
  expect(services.counts()).toEqual(before);
  await page.close();
  await other.close();
});

test('one detail dialog owns actions without moving the list; edits and optional deletion preserve identity', async () => {
  await options.getByRole('button', { name: '记录', exact: true }).click();
  await options.getByRole('button', { name: '紧凑', exact: true }).click();
  const word = options.getByRole('button', { name: '查看 reluctant 详情', exact: true });
  await expect(word).toBeVisible();
  const bounds = await word.boundingBox();
  await word.click();
  await expect(options.getByRole('dialog')).toHaveCount(1);
  expect(await word.boundingBox()).toEqual(bounds);
  await options.getByRole('button', { name: '编辑', exact: true }).click();
  await options.getByLabel('简短释义', { exact: true }).fill('not ready or willing');
  await options.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => services.notes.get(1)?.fields.Extra).toContain('not ready or willing');
  expect(services.counts().adds).toBe(1);
  await options.screenshot({ path: 'test-results/record-detail.png' });
  await options.getByText('原文与来源', { exact: true }).click();
  options.once('dialog', (dialog) => dialog.accept());
  await options.getByRole('button', { name: '移除来源' }).click();
  await expect(options.locator('.source')).toHaveCount(0);
  await expect.poll(() => services.notes.get(1)?.fields.Extra).not.toContain('<blockquote>');
  await options.getByRole('button', { name: '删除', exact: true }).click();
  await expect(options.getByLabel('同时删除 Anki 笔记')).not.toBeChecked();
  await options.getByRole('button', { name: '确认删除' }).click();
  await expect(options.getByRole('dialog')).toHaveCount(0);
  await expect(word).toHaveCount(0);
  expect(services.notes.size).toBe(1);
});

test('Anki night mode keeps answers legible without repeated examples', async () => {
  const note = services.notes.get(1)!;
  expect(note.fields.Extra).not.toContain('She was reluctant to leave.');
  const page = await context.newPage();
  await page.setContent(
    `<html><head><style>${cardStyle}</style></head><body class="card nightMode">${note.fields.Text!.replace(/\{\{c1::(.*?)\}\}/g, '<span class="cloze">$1</span>')}<hr>${note.fields.Extra}</body></html>`,
  );
  await expect(page.locator('.cloze').first()).toHaveCSS('color', 'rgb(164, 217, 180)');
  await page.close();
});

test('language exclusion updates existing pages and dynamic text while preserving explicit lookup', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/languages`);
  await page.locator('tap-gloss').waitFor({ state: 'attached' });
  const highlighted = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const css = CSS as typeof CSS & { highlights: Map<string, Set<Range>> };
      return [...(css.highlights.get('tapgloss-new') ?? [])].some((range) =>
        el.contains(range.startContainer),
      );
    });
  await expect.poll(() => highlighted('#chinese')).toBe(true);
  await options.getByRole('button', { name: '设置', exact: true }).click();
  await options.getByLabel('忽略语言', { exact: true }).click();
  await options.getByRole('option', { name: '中文', exact: true }).click();
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => highlighted('#chinese')).toBe(false);
  await expect.poll(() => highlighted('#english')).toBe(true);
  await expect.poll(() => highlighted('#japanese')).toBe(true);
  const before = services.counts().generations;
  await page.locator('#chinese').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(services.counts().generations).toBe(before);
  await page.locator('#chinese').evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el.firstChild!);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
  });
  await page.keyboard.press('Alt+q');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => services.counts().generations).toBe(before + 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'dynamic';
    p.textContent = 'The new paragraph should be highlighted.';
    document.body.append(p);
  });
  await expect.poll(() => highlighted('#dynamic')).toBe(true);
  await options.getByRole('button', { name: '移除中文', exact: true }).click();
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => highlighted('#chinese')).toBe(true);
  await page.close();
});

test('leaving settings aborts discovery; saving appearance never releases pending jobs', async () => {
  await options.getByRole('button', { name: '设置', exact: true }).click();
  holdModels = true;
  const previousAborts = modelAborts;
  await options.getByRole('button', { name: '获取模型', exact: true }).click();
  await expect(options.getByRole('button', { name: '正在获取…', exact: true })).toBeVisible();
  await options.getByRole('button', { name: '记录', exact: true }).click();
  await expect.poll(() => modelAborts).toBe(previousAborts + 1);
  holdModels = false;
  await options.getByRole('button', { name: '设置', exact: true }).click();
  const future = Date.now() + 3600000;
  await options.evaluate(async (nextAt) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('TapGloss');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('jobs', 'readwrite');
      tx.objectStore('jobs').put({
        id: 'generate:save-test',
        ref: 'save-test',
        kind: 'generate',
        token: 'unchanged',
        blocked: true,
        attempts: 3,
        nextAt,
        leaseUntil: 0,
      });
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, future);
  const before = services.counts();
  await options.getByLabel('外观', { exact: true }).click();
  await options.getByRole('option', { name: '浅色', exact: true }).click();
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect(options.getByRole('button', { name: '保存', exact: true })).toHaveAttribute('title', '已保存');
  const job = await options.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('TapGloss');
      r.onsuccess = () => resolve(r.result);
    });
    const result = await new Promise<{ nextAt: number; blocked: boolean; token: string }>((resolve) => {
      const r = db.transaction('jobs').objectStore('jobs').get('generate:save-test');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('jobs', 'readwrite');
      tx.objectStore('jobs').delete('generate:save-test');
      tx.oncomplete = () => resolve();
    });
    db.close();
    return result;
  });
  expect(job).toMatchObject({ nextAt: future, blocked: true, token: 'unchanged' });
  expect(services.counts()).toEqual(before);
});

test('clicking another word replaces an open lookup in one click', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/other`);
  await page.locator('tap-gloss').waitFor({ state: 'attached' });
  await page
    .locator('p')
    .first()
    .evaluate((p) => {
      p.innerHTML = 'She was <em id="first">reluctant</em> to ask for <em id="second">help</em>.';
    });
  await page.locator('#first').evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el.firstChild!);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
  });
  await page.keyboard.press('Alt+q');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.locator('#second').click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'help', exact: true })).toBeVisible();
  await page.close();
});

test('visible idle record page performs no periodic reads for 30 seconds', async () => {
  test.setTimeout(45000);
  await options.getByRole('button', { name: '记录', exact: true }).click();
  await options.waitForTimeout(200);
  await expect(options.locator('.word-list')).toHaveAttribute('aria-busy', 'false');
  await options.evaluate(() => {
    const scope = globalThis as unknown as {
      reads: number;
      chrome: { runtime: { sendMessage: (message: { type: string }) => Promise<unknown> } };
    };
    scope.reads = 0;
    const original = scope.chrome.runtime.sendMessage.bind(scope.chrome.runtime);
    scope.chrome.runtime.sendMessage = (message) => {
      if (['list', 'pendingDeletes', 'read', 'detail'].includes(message.type)) scope.reads++;
      return original(message);
    };
  });
  await options.waitForTimeout(30000);
  expect(await options.evaluate(() => (globalThis as unknown as { reads: number }).reads)).toBe(0);
});
