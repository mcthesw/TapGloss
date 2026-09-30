/* global process, chrome, URL, indexedDB, console, performance */
import { chromium } from '@playwright/test';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { shardFor } from '../src/storage/changes.ts';

const [countArg, existingPath] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const count = Number(countArg ?? 100000);
if (!Number.isInteger(count) || count < 1 || count > 100000) throw new Error('Use 1..100000 records');
const output = resolve('.output/backup-performance');
await mkdir(output, { recursive: true });
let requests = 0;
async function openProfile() {
  // Empty userDataDir creates a disposable profile, never the user's browser profile.
  const context = await chromium.launchPersistentContext('', {
    executablePath: process.env.TAPGLOSS_TEST_BROWSER,
    channel: 'chromium',
    headless: true,
    locale: 'zh-CN',
    viewport: { width: 1280, height: 1000 },
    args: [
      `--disable-extensions-except=${resolve('.output/chrome-mv3')}`,
      `--load-extension=${resolve('.output/chrome-mv3')}`,
    ],
  });
  context.on('request', (r) => {
    if (r.url().startsWith('http://127.0.0.1:9')) requests++;
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        baseUrl: 'http://127.0.0.1:9',
        apiKey: 'synthetic-backup-key',
        ankiUrl: 'http://127.0.0.1:9',
        theme: 'dark',
      },
    });
  });
  for (const page of context.pages()) await page.close();
  const page = await context.newPage();
  page.setDefaultTimeout(300000);
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#settings`);
  await page.getByRole('button', { name: '导出备份', exact: true }).waitFor();
  return { context, worker, page };
}
function rowSet(i) {
  const id = `backup-${String(i).padStart(6, '0')}`,
    term = `word${String(i).padStart(6, '0')}`;
  const sentence = `I saw ${term} in a book.`;
  const material = {
    language: 'en',
    lemma: term,
    sense: 'sample meaning',
    gloss: 'sample',
    sourceTarget: term,
    sourceOccurrence: 0,
    examples: [
      { text: `I recall ${term} today.`, target: term },
      { text: `We discussed ${term} yesterday.`, target: term },
      { text: `She explained ${term} clearly.`, target: term },
    ],
  };
  const rows = {
    captures: {
      id,
      entryId: id,
      source: {
        sentence,
        start: 6,
        end: 6 + term.length,
        url: `https://example.org/${i}`,
        title: 'Synthetic reading',
        location: 'p:0',
      },
      createdAt: i + 1,
    },
    entries: { id, language: 'en', lemma: term, sense: 'sample meaning', generationId: id, createdAt: i + 1 },
    generations: { id, captureId: id, material, createdAt: i + 1 },
    vocabulary: { id: `en:${term}`, language: 'en', lemma: term, forms: [term], state: 'learning' },
    catalog: {
      id: `entry:${id}`,
      entryId: id,
      captureId: id,
      term,
      gloss: 'sample',
      language: 'en',
      createdAt: i + 1,
      tokens: [term],
    },
    ankiBindings: { id, noteId: i + 1, syncedHash: 'synthetic', clozeFirstLetter: true },
  };
  const changes = Object.entries(rows)
    .filter(([table]) => ['captures', 'entries', 'generations', 'vocabulary'].includes(table))
    .map(([table, row]) => {
      const key = `${table}:${row.id}`;
      return { id: key, key: row.id, table, shard: shardFor(key), patch: row };
    });
  return { rows, changes };
}
const path = existingPath ? resolve(existingPath) : resolve(output, 'benchmark.tapgloss');
let exportMs;
if (!existingPath) {
  const first = await openProfile();
  try {
    const tables = [
      'captures',
      'entries',
      'generations',
      'vocabulary',
      'catalog',
      'ankiBindings',
      'syncChanges',
    ];
    for (let start = 0; start < count; start += 1000) {
      const data = Array.from({ length: Math.min(1000, count - start) }, (_, i) => rowSet(start + i));
      await first.worker.evaluate(
        async ({ tables, data }) => {
          const db = await new Promise((r, j) => {
            const request = indexedDB.open('TapGloss');
            request.onsuccess = () => r(request.result);
            request.onerror = () => j(request.error);
          });
          await new Promise((r, j) => {
            const tx = db.transaction(tables, 'readwrite');
            for (const item of data) {
              for (const [name, row] of Object.entries(item.rows)) tx.objectStore(name).put(row);
              for (const change of item.changes) tx.objectStore('syncChanges').put(change);
            }
            tx.oncomplete = r;
            tx.onerror = () => j(tx.error);
            tx.onabort = () => j(tx.error);
          });
          db.close();
        },
        { tables, data },
      );
    }
    console.log(`Seeded ${count} synthetic records in an isolated profile`);
    const started = performance.now();
    const event = first.page.waitForEvent('download', { timeout: 300000 });
    await first.page.getByRole('button', { name: '导出备份', exact: true }).click();
    await (await event).saveAs(path);
    exportMs = performance.now() - started;
    console.log(`Exported in ${Math.round(exportMs)} ms`);
  } finally {
    await first.context.close();
  }
}

const second = await openProfile();
try {
  const started = performance.now();
  await second.page.getByLabel('选择备份文件').setInputFiles(path);
  const dialog = second.page.getByRole('dialog', { name: '恢复备份' });
  await dialog.waitFor();
  const inspectMs = performance.now() - started;
  console.log(`Inspected in ${Math.round(inspectMs)} ms`);
  await second.page.screenshot({ path: resolve(output, 'preview.png'), fullPage: true });
  const importing = performance.now();
  await dialog.getByRole('button', { name: '确认恢复' }).click();
  await second.page.getByRole('status').filter({ hasText: '恢复完成' }).waitFor();
  const restoreMs = performance.now() - importing;
  console.log(`Restored in ${Math.round(restoreMs)} ms`);
  const warmStart = performance.now();
  const warmDownload = second.page.waitForEvent('download', { timeout: 300000 });
  await second.page.getByRole('button', { name: '导出备份', exact: true }).click();
  await (await warmDownload).saveAs(resolve(output, 'warm.tapgloss'));
  const warmExportMs = performance.now() - warmStart;
  console.log(`Warm export in ${Math.round(warmExportMs)} ms`);
  const repeatStart = performance.now();
  await second.page.getByLabel('选择备份文件').setInputFiles(path);
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '确认恢复' }).click();
  await second.page.getByRole('status').filter({ hasText: '恢复完成' }).waitFor();
  const repeatRestoreMs = performance.now() - repeatStart;
  console.log(`Repeated restore in ${Math.round(repeatRestoreMs)} ms`);
  let coldExportMs;
  if (process.argv.includes('--cold-export')) {
    // Recreate an unsynced installation from canonical rows, outside the measured export.
    await second.worker.evaluate(async () => {
      const db = await new Promise((r, j) => {
        const req = indexedDB.open('TapGloss');
        req.onsuccess = () => r(req.result);
        req.onerror = () => j(req.error);
      });
      const tables = ['captures', 'entries', 'generations', 'vocabulary'];
      await new Promise((r, j) => {
        const tx = db.transaction([...tables, 'syncChanges', 'syncShards'], 'readwrite');
        tx.objectStore('syncShards').clear();
        tx.objectStore('syncChanges').clear();
        for (const table of tables) {
          const request = tx.objectStore(table).getAll();
          request.onsuccess = () => {
            for (const row of request.result) {
              const id = `${table}:${row.id}`;
              let hash = 2166136261;
              for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
              const patch = Object.fromEntries(
                Object.entries(row).filter(
                  ([key, value]) =>
                    value !== undefined && !['deleted', 'deletedAt', 'restoreDeletions'].includes(key),
                ),
              );
              tx.objectStore('syncChanges').put({
                id,
                table,
                key: row.id,
                shard: ((hash >>> 0) % 64).toString(16).padStart(2, '0'),
                patch,
              });
            }
          };
        }
        tx.oncomplete = r;
        tx.onerror = () => j(tx.error);
        tx.onabort = () => j(tx.error);
      });
      db.close();
    });
    console.log(`Prepared ${count * 4} pending changes for cold export`);
    const coldStart = performance.now();
    const coldDownload = second.page.waitForEvent('download', { timeout: 600000 });
    await second.page.getByRole('button', { name: '导出备份', exact: true }).click();
    await (await coldDownload).saveAs(resolve(output, 'cold.tapgloss'));
    coldExportMs = performance.now() - coldStart;
    console.log(`Cold export in ${Math.round(coldExportMs)} ms`);
    await second.page.getByLabel('选择备份文件').setInputFiles(resolve(output, 'cold.tapgloss'));
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  const counts = await second.worker.evaluate(async () => {
    const db = await new Promise((r) => {
      const request = indexedDB.open('TapGloss');
      request.onsuccess = () => r(request.result);
    });
    const result = {};
    for (const name of [
      'captures',
      'entries',
      'generations',
      'vocabulary',
      'catalog',
      'ankiBindings',
      'jobs',
      'syncChanges',
    ]) {
      result[name] = await new Promise((r, j) => {
        const req = db.transaction(name).objectStore(name).count();
        req.onsuccess = () => r(req.result);
        req.onerror = () => j(req.error);
      });
    }
    db.close();
    return result;
  });
  if (
    ['captures', 'entries', 'generations', 'vocabulary', 'catalog', 'ankiBindings'].some(
      (name) => counts[name] !== count,
    ) ||
    counts.jobs !== 0 ||
    counts.syncChanges !== 0 ||
    requests !== 0
  )
    throw new Error(JSON.stringify({ counts, requests }));
  const report = {
    count,
    bytes: (await stat(path)).size,
    exportMs,
    inspectMs,
    restoreMs,
    warmExportMs,
    repeatRestoreMs,
    coldExportMs,
    counts,
    serviceRequests: requests,
  };
  await second.page.screenshot({ path: resolve(output, 'restored.png'), fullPage: true });
  await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await second.context.close();
}
