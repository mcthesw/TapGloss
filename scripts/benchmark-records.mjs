/* global process, URL, chrome, performance, indexedDB, console, window, document, requestAnimationFrame */
// Run after `pnpm build`. Uses an isolated profile and synthetic records; never connects to Anki or an LLM.
import { chromium } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir, cpus, totalmem } from 'node:os';

const count = Number(process.argv[2] ?? 100000);
if (!Number.isInteger(count) || count < 100 || count > 1000000)
  throw new Error('Expected 100–1000000 records');
const out = resolve('.output', `benchmark-${count}-v2`);
await mkdir(out, { recursive: true });
const extension = join(out, 'extension');
const legacy = process.env.TAPGLOSS_BENCH_LEGACY;
await cp(legacy ? resolve(legacy) : resolve('.output/chrome-mv3'), extension, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'tapgloss-benchmark-'));
const browserOptions = {
  executablePath: process.env.TAPGLOSS_TEST_BROWSER,
  channel: 'chromium',
  locale: 'zh-CN',
  headless: true,
  colorScheme: 'dark',
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
};
const open = () => chromium.launchPersistentContext(profile, browserOptions);
let context = await open();
let worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const extensionId = new URL(worker.url()).host;
await worker.evaluate(() =>
  chrome.storage.local.set({
    settings: {
      apiKey: 'benchmark-only',
      baseUrl: 'http://127.0.0.1:9',
      ankiUrl: 'http://127.0.0.1:9',
      theme: 'dark',
    },
  }),
);
for (const page of context.pages()) await page.close();
let original;
if (count === 1000) {
  try {
    original = JSON.parse(await readFile('.output/benchmark-1000/fixture.json', 'utf8')).records;
  } catch {
    /* Optional exact baseline fixture. */
  }
}
const started = performance.now();
for (let start = 0; start < count; start += 1000) {
  await worker.evaluate(
    async ({ start, count, original, includeCatalog }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('TapGloss');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tables = [
        'captures',
        'entries',
        'generations',
        'vocabulary',
        'jobs',
        ...(includeCatalog ? ['catalog'] : []),
      ];
      await new Promise((resolve, reject) => {
        const tx = db.transaction(tables, 'readwrite');
        if (!start) for (const name of tables) tx.objectStore(name).clear();
        const bases = [
          'repository',
          'collaborator',
          'language',
          'question',
          'available',
          'performance',
          'remember',
          'important',
          'thoughtful',
          'connection',
        ];
        for (let i = start; i < Math.min(start + 1000, count); i++) {
          const term = `${bases[i % bases.length]}${String(i).padStart(6, '0')}`,
            id = `benchmark-${String(i).padStart(6, '0')}`;
          const sentence = `I noticed the word ${term} while reading the article.`,
            selected = sentence.indexOf(term);
          const c = original?.[i]?.capture ?? {
            id,
            entryId: id,
            source: {
              sentence,
              start: selected,
              end: selected + term.length,
              title: 'Reading notes',
              url: `https://example.org/${i}`,
              location: 'p:0',
            },
            createdAt: count - i,
          };
          const e = original?.[i]?.entry ?? {
            id,
            language: 'en',
            lemma: term,
            sense: 'contextual use',
            generationId: id,
            createdAt: count - i,
            noteId: i + 1,
          };
          const g = original?.[i]?.generation ?? {
            id,
            captureId: id,
            createdAt: count - i,
            material: {
              language: 'en',
              lemma: term,
              sense: 'contextual use',
              gloss: 'A word encountered while reading.',
              sourceTarget: term,
              sourceOccurrence: 0,
              examples: [
                { text: `I noticed ${term} in the book.`, target: term },
                { text: `We used ${term} in a new sentence.`, target: term },
                { text: `She asked what ${term} means here.`, target: term },
              ],
            },
          };
          const v = original?.[i]?.vocabulary ?? {
            id: `en:${term}`,
            language: 'en',
            lemma: term,
            forms: [term],
            state: i % 5 ? 'learning' : 'known',
          };
          tx.objectStore('captures').put(c);
          tx.objectStore('entries').put(e);
          tx.objectStore('generations').put(g);
          tx.objectStore('vocabulary').put(v);
          if (includeCatalog) {
            const text = `${e.lemma} ${g.material.gloss} ${c.source.sentence}`;
            const tokens = [
              ...new Set(
                [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text.toLowerCase())]
                  .filter((p) => p.isWordLike)
                  .map((p) => p.segment),
              ),
            ];
            tx.objectStore('catalog').put({
              id: `entry:${e.id}`,
              entryId: e.id,
              captureId: c.id,
              term: e.lemma,
              gloss: g.material.gloss,
              language: e.language,
              createdAt: e.createdAt,
              tokens,
            });
          }
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { start, count, original, includeCatalog: !legacy },
  );
  if (start % 10000 === 0) console.log(`Seeded ${Math.min(start + 1000, count)}/${count}`);
}
console.log('Seed finished:', Math.round(performance.now() - started), 'ms');
await context.close();
if (legacy) await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
const upgradeStarted = performance.now();
context = await open();
console.log('Opening upgraded extension page…');
if (legacy) {
  const reloadPage = await context.newPage();
  await reloadPage.goto('chrome://extensions/');
  await reloadPage.evaluate(
    () =>
      new Promise((resolve) =>
        chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, resolve),
      ),
  );
  await reloadPage.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        chrome.developerPrivate.reload(id, { failQuietly: true }, () =>
          chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(),
        );
      }),
    extensionId,
  );
  await reloadPage.evaluate(
    (id) => new Promise((resolve) => chrome.management.setEnabled(id, true, resolve)),
    extensionId,
  );
  await reloadPage.close();
}

await context.addInitScript(() => {
  window.benchmark = { calls: [], ready: null };
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = async (message) => {
    const started = performance.now(),
      result = await send(message);
    window.benchmark.calls.push({
      type: message.type,
      ms: performance.now() - started,
      bytes: JSON.stringify(result).length,
    });
    return result;
  };
});
const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/options.html`);
worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 30000 }));
await page.getByRole('button', { name: '紧凑', exact: true }).click({ timeout: 180000 });
await page.waitForFunction(
  () => document.querySelectorAll('.word-item').length === 100,
  {},
  { timeout: 180000 },
);
const report = {
  count,
  legacyUpgrade: !!legacy,
  upgradeAndLaunchMs: performance.now() - upgradeStarted,
  environment: {
    cpu: cpus()[0].model,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    browser: context.browser().version(),
    viewport: browserOptions.viewport,
    headless: true,
  },
  loadRuns: [],
};
for (const other of context.pages()) if (other !== page) await other.close();
for (let i = 0; i < 5; i++) {
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.word-item').length === 100 &&
      document.querySelector('.word-list').getAttribute('aria-busy') === 'false',
  );
  const time = await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return performance.now();
  });
  report.loadRuns.push(time);
  if (!i) report.firstRead = await page.evaluate(() => window.benchmark.calls);
  console.log('Load', i + 1, Math.round(time), 'ms');
}
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('HeapProfiler.collectGarbage');
const metrics = async () =>
  Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
report.metrics = await metrics();
report.domElements = await page.evaluate(() => document.querySelectorAll('*').length);
await page.screenshot({ path: `${out}/first-page.png`, fullPage: true });
const before = await metrics();
const readCount = await page.evaluate(() => window.benchmark.calls.length);
await page.waitForTimeout(30000);
const after = await metrics();
report.idle = {
  seconds: after.Timestamp - before.Timestamp,
  mainThreadBusyMs: (after.TaskDuration - before.TaskDuration) * 1000,
  additionalCalls: await page.evaluate((n) => window.benchmark.calls.slice(n), readCount),
};
console.log('Idle:', JSON.stringify(report.idle));
const lastTerm = original ? original.at(-1).entry.lemma : `connection${String(count - 1).padStart(6, '0')}`;
const searchStarted = performance.now();
await page.getByLabel('搜索记录', { exact: true }).fill(lastTerm);
await page.getByRole('button', { name: `查看 ${lastTerm} 详情`, exact: true }).waitFor();
report.searchMs = performance.now() - searchStarted;
const boxBefore = await page
  .getByRole('button', { name: `查看 ${lastTerm} 详情`, exact: true })
  .boundingBox();
const detailStarted = performance.now();
await page.getByRole('button', { name: `查看 ${lastTerm} 详情`, exact: true }).click();
await page.getByRole('dialog').locator('.example').first().waitFor();
report.detailMs = performance.now() - detailStarted;
report.listStable =
  JSON.stringify(boxBefore) ===
  JSON.stringify(
    await page.getByRole('button', { name: `查看 ${lastTerm} 详情`, exact: true }).boundingBox(),
  );
await page.screenshot({ path: `${out}/last-record-detail.png` });
await page.getByRole('button', { name: '关闭详情' }).click();
await page.getByLabel('搜索记录', { exact: true }).fill('');
await page.waitForFunction(() => document.querySelectorAll('.word-item').length === 100);
const nextStarted = performance.now();
await page.getByRole('button', { name: '下一页', exact: true }).click();
await page.getByText('101–200', { exact: true }).waitFor();
report.nextPageMs = performance.now() - nextStarted;
const cursorEntry = original?.[count - 101]?.entry;
const beforeCursor = cursorEntry
  ? [cursorEntry.createdAt, `entry:${cursorEntry.id}`]
  : [101, `entry:benchmark-${String(count - 101).padStart(6, '0')}`];
report.deepPage = await page.evaluate(
  async ({ offset, before }) => {
    const start = performance.now();
    const result = await chrome.runtime.sendMessage({
      type: 'list',
      data: { query: '', offset, before, examples: false },
    });
    return {
      ms: performance.now() - start,
      count: result.data.records.length,
      bytes: JSON.stringify(result).length,
    };
  },
  { offset: count - 100, before: beforeCursor },
);
report.finalCounts = await worker.evaluate(async () => {
  const db = await new Promise((resolve) => {
    const r = indexedDB.open('TapGloss');
    r.onsuccess = () => resolve(r.result);
  });
  const counts = {};
  for (const name of ['entries', 'catalog', 'jobs'])
    counts[name] = await new Promise((resolve) => {
      const r = db.transaction(name).objectStore(name).count();
      r.onsuccess = () => resolve(r.result);
    });
  db.close();
  return counts;
});
await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
console.log(
  'RESULT',
  JSON.stringify({
    ...report,
    metrics: { heapMiB: report.metrics.JSHeapUsedSize / 2 ** 20 },
    firstRead: report.firstRead,
  }),
);
await context.close();
