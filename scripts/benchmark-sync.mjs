/* global process, console, URL, indexedDB, performance, chrome */
// Real Chromium IndexedDB + local S3-compatible server, isolated profiles and synthetic records only.
import { chromium } from '@playwright/test';
import S3rver from 's3rver';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const count = Number(process.argv[2] ?? 100000);
if (!Number.isInteger(count) || count < 100 || count > 100000) throw new Error('Expected 100..100000');
const directory = await mkdtemp(join(tmpdir(), 'tapgloss-sync-benchmark-'));
const server = new S3rver({
  address: '127.0.0.1',
  port: 0,
  silent: true,
  directory,
  configureBuckets: [{ name: 'benchmark', configs: [] }],
});
const { port } = await server.run();
const contexts = [],
  pages = [];
const rpc = (page, message) => page.evaluate((message) => chrome.runtime.sendMessage(message), message);
const measured = async (action) => {
  const started = performance.now();
  const result = await action();
  if (result?.ok === false || result?.data?.error) throw new Error(JSON.stringify(result));
  return Math.round(performance.now() - started);
};
try {
  for (let i = 0; i < 2; i++) {
    const extension = resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      executablePath: process.env.TAPGLOSS_TEST_BROWSER,
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    contexts.push(context);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
    const current = await rpc(page, { type: 'settings' });
    await rpc(page, {
      type: 'saveSettings',
      data: {
        ...current.data,
        baseUrl: 'http://127.0.0.1:9',
        ankiUrl: 'http://127.0.0.1:9',
        apiKey: 'benchmark-only',
        sync: {
          backend: 's3',
          endpoint: `http://127.0.0.1:${port}`,
          bucket: 'benchmark',
          region: 'us-east-1',
          username: 'S3RVER',
          password: 'S3RVER',
          workspace: 'performance',
        },
      },
    });
    // Manual benchmark controls scheduling so no alarm overlaps the measurement.
    await worker.evaluate(() => chrome.alarms.clear('sync'));
    pages.push(page);
  }
  const [a, b] = pages;
  const seedMs = await measured(async () => {
    for (let base = 0; base < count; base += 1000) {
      await a.evaluate(
        async ({ base, count }) => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('TapGloss');
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          const tables = ['captures', 'entries', 'generations', 'vocabulary', 'syncChanges'];
          await new Promise((resolve, reject) => {
            const tx = db.transaction(tables, 'readwrite');
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
            for (let i = base; i < Math.min(base + 1000, count); i++) {
              const id = String(i).padStart(6, '0'),
                lemma = `expression${id}`;
              const text = `We discussed ${lemma} today.`;
              const rows = {
                captures: {
                  id: `c${id}`,
                  source: {
                    url: 'https://example.org/reading',
                    title: 'Synthetic reading',
                    sentence: text,
                    start: 13,
                    end: 13 + lemma.length,
                    location: id,
                  },
                  entryId: `e${id}`,
                  createdAt: i,
                },
                entries: {
                  id: `e${id}`,
                  lemma,
                  language: 'en',
                  sense: 'example sense',
                  generationId: `g${id}`,
                  createdAt: i,
                },
                generations: {
                  id: `g${id}`,
                  captureId: `c${id}`,
                  material: {
                    lemma,
                    language: 'en',
                    sense: 'example sense',
                    gloss: 'A synthetic benchmark expression',
                    sourceTarget: lemma,
                    sourceOccurrence: 0,
                    examples: [text, `She explained ${lemma} clearly.`, `I remember ${lemma} well.`].map(
                      (text) => ({ text, target: lemma }),
                    ),
                  },
                  createdAt: i,
                },
                vocabulary: { id: `en:${lemma}`, lemma, language: 'en', forms: [lemma], state: 'learning' },
              };
              for (const [table, row] of Object.entries(rows)) {
                tx.objectStore(table).put(row);
                const key = `${table}:${row.id}`;
                let hash = 2166136261;
                for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
                tx.objectStore('syncChanges').put({
                  id: key,
                  key: row.id,
                  table,
                  shard: ((hash >>> 0) % 64).toString(16).padStart(2, '0'),
                  patch: row,
                });
              }
            }
          });
          db.close();
        },
        { base, count },
      );
      if ((base + 1000) % 20000 === 0) console.log(`Seeded ${base + 1000} / ${count}`);
    }
  });
  console.log(`Seed complete: ${seedMs} ms`);
  const uploadMs = await measured(() => rpc(a, { type: 'syncNow' }));
  console.log(`Initial upload: ${uploadMs} ms`);
  const downloadMs = await measured(() => rpc(b, { type: 'syncNow' }));
  console.log(`Second device: ${downloadMs} ms`);
  await rpc(a, { type: 'syncNow' }); // Cache our own remote revisions once.
  const unchangedMs = await measured(() => rpc(a, { type: 'syncNow' }));
  await rpc(a, { type: 'state', data: { id: 'en:expression000000', state: 'known' } });
  const changeMs = await measured(() => rpc(a, { type: 'syncNow' }));
  const receiveChangeMs = await measured(() => rpc(b, { type: 'syncNow' }));
  const details = await b.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('TapGloss');
      r.onsuccess = () => resolve(r.result);
    });
    const get = (table, method, key) =>
      new Promise((resolve) => {
        const r = db.transaction(table).objectStore(table)[method](key);
        r.onsuccess = () => resolve(r.result);
      });
    const shards = await get('syncShards', 'getAll');
    const result = {
      records: await get('catalog', 'count'),
      bindings: await get('ankiBindings', 'count'),
      known: (await get('vocabulary', 'get', 'en:expression000000')).state,
      shards: shards.length,
      totalBytes: shards.reduce((n, s) => n + s.bytes.length, 0),
      maxShardBytes: Math.max(...shards.map((s) => s.bytes.length)),
    };
    db.close();
    return result;
  });
  if (details.records !== count || details.bindings !== 0 || details.known !== 'known')
    throw new Error(JSON.stringify(details));
  const result = {
    count,
    environment: 'Chromium IndexedDB and local S3-compatible HTTP server; no WAN latency',
    seedMs,
    uploadMs,
    downloadMs,
    unchangedMs,
    changeMs,
    receiveChangeMs,
    ...details,
  };
  await mkdir('.output/sync-performance', { recursive: true });
  await writeFile(`.output/sync-performance/${count}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
