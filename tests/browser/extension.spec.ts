import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fakeServices } from '../fixtures';
import { defaultPrompt } from '../../src/explain/prompt';
import { cardStyle } from '../../src/anki/template';

let context: BrowserContext, server: Server, origin: string, options: Page, extensionId: string;
const services = fakeServices();
let failModels = false,
  failGeneration = false,
  lastPrompt = '';
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
  await expect(options.getByLabel('模型', { exact: true })).toHaveValue('test-model');
  await options.getByLabel('AnkiConnect 地址', { exact: true }).fill(`${origin}/anki`);
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect(options.getByRole('button', { name: '保存', exact: true })).toHaveAttribute('title', '已保存');
});

test('AI discovery, prompt reset and live connection checks do not create learning records', async () => {
  await options.evaluate(() => {
    const scope = globalThis as unknown as {
      chrome: { runtime: { sendMessage: (message: { type: string }) => Promise<unknown> } };
      failSave?: boolean;
    };
    const send = scope.chrome.runtime.sendMessage.bind(scope.chrome.runtime);
    scope.chrome.runtime.sendMessage = async (message) => {
      if (message.type === 'saveSettings') {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (scope.failSave) return { ok: false, error: '保存失败，请重试' };
      }
      return send(message);
    };
  });
  const save = options.getByRole('button', { name: '保存', exact: true });
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expect(save.locator('rect')).toHaveCSS('animation-name', 'save-progress');
  await options.locator('.app-header').screenshot({ path: 'test-results/save-loading.png' });
  await expect(save).toHaveAttribute('aria-busy', 'false');
  await expect(save).toHaveCSS('background-color', 'rgb(35, 131, 75)');
  await expect(save).toHaveCSS('color', 'rgb(255, 255, 255)');
  await options.evaluate(() => {
    (globalThis as unknown as { failSave: boolean }).failSave = true;
  });
  await save.click();
  await expect(options.getByRole('alert')).toContainText('保存失败');
  await expect(save).not.toHaveClass(/saved/);
  await options.evaluate(() => {
    (globalThis as unknown as { failSave: boolean }).failSave = false;
  });
  await save.click();
  await expect(save).toHaveAttribute('title', '已保存');
  await options.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(options.getByRole('listbox', { name: '可用模型' }).getByRole('option')).toHaveCount(2);
  await options.getByRole('option', { name: 'second-model', exact: true }).click();
  await expect(options.getByLabel('模型', { exact: true })).toHaveValue('second-model');
  await options.getByRole('button', { name: '选择模型', exact: true }).click();
  await options.getByLabel('模型', { exact: true }).press('ArrowUp');
  await options.getByLabel('模型', { exact: true }).press('Enter');
  await expect(options.getByLabel('模型', { exact: true })).toHaveValue('test-model');
  await options.getByRole('button', { name: '测试 Anki 连接', exact: true }).click();
  await expect(options.getByRole('status').filter({ hasText: 'Anki 连接正常' })).toBeVisible();
  expect(services.notes.size).toBe(0);
  services.offline(true);
  await options.getByRole('button', { name: '测试 Anki 连接', exact: true }).click();
  await expect(options.getByRole('status').filter({ hasText: 'Anki 连接失败' })).toBeVisible();
  services.offline(false);
  const helpButton = options.getByRole('button', { name: 'Anki 帮助', exact: true });
  await helpButton.hover();
  const help = options.getByRole('region', { name: 'Anki 帮助', exact: true });
  await help.getByRole('link', { name: 'AnkiConnect', exact: true }).hover();
  await expect(help).toBeVisible();
  await context.route('https://ankiweb.net/shared/info/2055492159', (route) =>
    route.fulfill({ body: 'AnkiConnect help' }),
  );
  const linkedPage = context.waitForEvent('page');
  await help.getByRole('link').click();
  await (await linkedPage).close();
  await helpButton.click();
  await options.getByRole('heading', { name: 'TapGloss.' }).hover();
  await expect(help).toBeVisible();
  await options.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await options.getByText('生成提示词', { exact: true }).click();
  const prompt = options.getByLabel('提示词', { exact: true });
  await prompt.fill(`${defaultPrompt}\nPrefer everyday examples.`);
  await options.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(options.getByRole('status').filter({ hasText: '连接正常' })).toBeVisible();
  expect(lastPrompt).toContain('Prefer everyday examples.');
  expect(services.notes.size).toBe(0);
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect(options.getByRole('button', { name: '保存', exact: true })).toHaveAttribute('title', '已保存');
  await options.reload();
  await options.getByRole('button', { name: '设置', exact: true }).click();
  await options.getByText('生成提示词', { exact: true }).click();
  await expect(prompt).toHaveValue(`${defaultPrompt}\nPrefer everyday examples.`);
  await options.getByRole('button', { name: '恢复默认提示词' }).click();
  await expect(prompt).toHaveValue(defaultPrompt);
  failGeneration = true;
  await options.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(options.getByRole('status').filter({ hasText: 'API 密钥无效' })).toBeVisible();
  failGeneration = false;
  failModels = true;
  await options.getByRole('button', { name: '刷新模型', exact: true }).click();
  await expect(options.getByText('无法获取模型', { exact: false })).toBeVisible();
  await expect(options.getByLabel('模型', { exact: true })).toHaveValue('test-model');
  failModels = false;
  await options.getByRole('button', { name: '刷新模型', exact: true }).click();
  await expect(options.getByText('已获取 2 个模型')).toBeVisible();
  await options.getByLabel('模型', { exact: true }).fill('my-custom-model');
  await options.getByRole('button', { name: '刷新模型', exact: true }).click();
  await expect(options.getByText('已获取 2 个模型')).toBeVisible();
  await expect(options.getByLabel('模型', { exact: true })).toHaveValue('my-custom-model');
  await options.getByLabel('模型', { exact: true }).fill('test-model');
  await options.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(options.getByRole('status').filter({ hasText: '连接正常' })).toBeVisible();
  await options.getByText('生成提示词', { exact: true }).click();
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await options.emulateMedia({ colorScheme: 'dark' });
  await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
  await options.screenshot({ path: 'test-results/settings-dark.png', fullPage: true });
  await options.getByText('生成提示词', { exact: true }).click();
  const rightCards = options.locator('.settings-column').nth(1).locator('.paper');
  const first = (await rightCards.nth(0).boundingBox())!;
  const second = (await rightCards.nth(1).boundingBox())!;
  expect(Math.round(second.y - first.y - first.height)).toBe(20);
  await expect(options.getByRole('button', { name: '保存', exact: true })).toHaveCSS(
    'background-color',
    'rgb(35, 131, 75)',
  );
  await options.screenshot({ path: 'test-results/settings-expanded-dark.png', fullPage: true });
  await options.getByText('生成提示词', { exact: true }).click();
  await options.getByLabel('外观', { exact: true }).click();
  await options.getByRole('option', { name: '浅色', exact: true }).click();
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect(options.locator('html')).toHaveAttribute('data-theme', 'light');
  await options.getByLabel('外观', { exact: true }).click();
  await options.getByRole('option', { name: '自动', exact: true }).click();
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
  await options.getByRole('button', { name: '记录', exact: true }).click();
  await expect(options.getByRole('article')).toHaveCount(0);
  await expect(options.locator('.app-header').getByRole('group', { name: '记录大小' })).toBeVisible();
  await options.screenshot({ path: 'test-results/records-empty.png', fullPage: true });
});
test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((done) => server?.close(() => done()));
});

test('point lookup, original context, automatic export, repeat reuse and known-word escape hatch', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/reading`);
  await page.locator('tap-gloss').waitFor({ state: 'attached' });
  await page.locator('em').click();
  const popup = page.getByRole('dialog', { name: '语境查询' });
  await expect(popup).toBeVisible();
  await expect(popup.locator('.source')).toContainText('She was reluctant to ask for help.');
  await expect(popup.getByRole('status')).toHaveText('已保存到 Anki');
  await expect(popup.locator('.example')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/lookup.png' });
  await page.evaluate(() => {
    document.body.style.backgroundColor = '#10151b';
    document.body.style.color = '#dde5eb';
  });
  await expect(page.locator('tap-gloss')).toHaveAttribute('data-theme', 'dark');
  await expect(popup).toHaveCSS('background-color', 'rgb(30, 30, 30)');
  await page.screenshot({ path: 'test-results/lookup-dark.png' });
  const before = services.counts();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await page.locator('tap-gloss').waitFor({ state: 'attached' });
  await page.locator('em').click();
  await expect(popup.getByRole('status')).toHaveText('已保存到 Anki');
  expect(services.counts()).toEqual(before);
  await popup.getByRole('button', { name: '认识了' }).click();
  await expect(popup.getByRole('button', { name: '恢复学习' })).toBeVisible();
  await popup.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('em').click();
  await expect(popup).toHaveCount(0);
  await page.locator('em').evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.firstChild!);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press('Alt+q');
  await expect(popup).toBeVisible();
  await page.close();
});

test('Anki night mode shows legible answers and collapsed sources without repeated examples', async () => {
  const note = services.notes.get(1)!;
  expect(note.fields.Extra).not.toContain('She was reluctant to leave.');
  const page = await context.newPage();
  const answers = note.fields.Text!.replace(/\{\{c1::(.*?)\}\}/g, '<span class="cloze">$1</span>');
  await page.setContent(
    `<html><head><style>${cardStyle}</style></head><body class="card nightMode">${answers}<hr id="answer">${note.fields.Extra}</body></html>`,
  );
  await expect(page.locator('.cloze').first()).toHaveCSS('color', 'rgb(164, 217, 180)');
  await expect(page.locator('blockquote')).not.toBeVisible();
  await page.screenshot({ path: 'test-results/anki-dark.png', fullPage: true });
  await page.getByText('原文与来源', { exact: true }).click();
  await expect(page.locator('blockquote')).toBeVisible();
  await page.close();
});

test('records editor preserves Anki identity and deletion is opt-in', async () => {
  await options.getByRole('button', { name: '记录', exact: true }).click();
  await expect(options.getByRole('article')).toHaveCount(1);
  await options.getByRole('button', { name: '编辑', exact: true }).click();
  await options.getByLabel('简短释义', { exact: true }).fill('not ready or willing');
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect(options.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => services.notes.get(1)?.fields.Extra).toContain('not ready or willing');
  expect(services.counts().adds).toBe(1);
  await expect(options.getByRole('article')).toContainText('已保存到 Anki');
  await options.screenshot({ path: 'test-results/records.png' });
  await options.getByRole('button', { name: '紧凑', exact: true }).click();
  await expect(options.locator('.example').first()).not.toBeVisible();
  await expect(options.getByRole('button', { name: '恢复学习' })).toHaveAttribute('aria-pressed', 'true');
  expect((await options.getByRole('article').boundingBox())!.height).toBeLessThanOrEqual(42);
  expect((await options.getByRole('article').boundingBox())!.width).toBeLessThan(300);
  await expect(options.getByRole('article')).toHaveCSS('border-top-width', '0px');
  await expect(options.getByRole('article').getByRole('button', { name: '编辑', exact: true })).toHaveCSS(
    'border-top-width',
    '0px',
  );
  await options.screenshot({ path: 'test-results/records-compact-dark.png' });
  await options.reload();
  await expect(options.getByRole('button', { name: '紧凑', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await options.getByRole('button', { name: /查看 .* 详情/ }).click();
  await expect(options.locator('.example').first()).toBeVisible();
  await options.getByRole('button', { name: '标准', exact: true }).click();
  await options.getByText('原文与来源', { exact: true }).click();
  options.once('dialog', (dialog) => dialog.accept());
  await options.getByRole('button', { name: '移除来源' }).click();
  await expect(options.locator('.source')).toHaveCount(0);
  await expect(options.getByRole('article')).toHaveCount(1);
  await expect.poll(() => services.notes.get(1)?.fields.Extra).not.toContain('<blockquote>');
  await options.getByRole('button', { name: '删除', exact: true }).click();
  await expect(options.getByLabel('同时删除 Anki 笔记')).not.toBeChecked();
  await expect(options.getByRole('dialog')).toBeVisible();
  await options.keyboard.press('Escape');
  await expect(options.getByRole('dialog')).toHaveCount(0);
  await options.getByRole('button', { name: '删除', exact: true }).click();
  await options.getByRole('button', { name: '确认删除' }).click();
  await expect(options.getByRole('article')).toHaveCount(0);
  expect(services.notes.size).toBe(1);
});

test('content extraction keeps inline nodes and distinguishes repeated occurrences', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/other`);
  await page.locator('tap-gloss').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    document.querySelector('p')!.innerHTML = '<em>reluctant</em> or <em>reluctant</em>?';
  });
  // An intentionally inconsistent model answer must never create an incorrect card.
  await page
    .locator('em')
    .nth(1)
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el.firstChild!);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    });
  await page.keyboard.press('Alt+q');
  const popup = page.getByRole('dialog');
  await expect(popup.locator('.source')).toContainText('reluctant or reluctant?');
  await expect(popup.getByRole('status')).toContainText('未包含选中内容');
  expect(services.counts().adds).toBe(1);
  await page.close();
});

test('language exclusions suppress native text while keeping mixed-language words and explicit lookup', async () => {
  // Remove the deliberately invalid capture from the preceding test before changing settings.
  await options.getByRole('button', { name: '记录', exact: true }).click();
  await expect(options.getByRole('article')).toHaveCount(1);
  await options.getByRole('button', { name: '删除', exact: true }).click();
  await options.getByRole('button', { name: '确认删除' }).click();
  await expect(options.getByRole('article')).toHaveCount(0);
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
  await expect(options.getByRole('button', { name: '保存', exact: true })).toHaveAttribute('title', '已保存');
  await expect.poll(() => highlighted('#chinese')).toBe(false);
  await expect.poll(() => highlighted('#english')).toBe(true);
  await expect.poll(() => highlighted('#japanese')).toBe(true);
  const before = services.counts().generations;
  await page.locator('#chinese').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(services.counts().generations).toBe(before);
  await options.screenshot({ path: 'test-results/language-settings.png', fullPage: true });
  await page.screenshot({ path: 'test-results/language-filter.png' });
  await page.locator('#chinese').evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.firstChild!);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });
  await page.keyboard.press('Alt+q');
  await expect(page.getByRole('dialog', { name: '语境查询' })).toBeVisible();
  await expect.poll(() => services.counts().generations).toBe(before + 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await options.getByRole('button', { name: '移除中文', exact: true }).click();
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => highlighted('#chinese')).toBe(true);
  await page.close();
});
