import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { settingsSchema, validateMaterial } from '../src/domain/model';
import { Database, capture, queue, removeEntry, view } from '../src/storage/database';
import { Worker } from '../src/storage/worker';
import { requestSchema } from '../src/messages';
import { availableModels, explain } from '../src/explain/client';
import { Anki } from '../src/anki/client';

export default defineBackground(() => {
  const db = new Database();
  const settings = async () =>
    settingsSchema.parse((await browser.storage.local.get('settings')).settings ?? {});
  const worker = new Worker(db, settings);
  const wake = () => {
    void worker.run().catch(() => {
      /* Durable jobs are retried by the next alarm. */
    });
  };
  browser.alarms.onAlarm.addListener(wake);
  browser.runtime.onStartup.addListener(wake);
  void browser.alarms.create('work', { periodInMinutes: 1 });
  (browser.action ?? browser.browserAction).onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });
  browser.runtime.onInstalled.addListener(() => {
    void browser.runtime.openOptionsPage();
    wake();
  });
  browser.runtime.onMessage.addListener((raw, sender) => {
    if (sender.id !== browser.runtime.id) return;
    return (async () => {
      try {
        const request = requestSchema.parse(raw);
        const trusted = sender.url?.startsWith(browser.runtime.getURL('/'));
        if (!trusted && !['lookup', 'read', 'vocabulary', 'state', 'open'].includes(request.type))
          throw new Error('此操作只能在扩展页面中进行');
        let data: unknown;
        switch (request.type) {
          case 'lookup':
            data = await capture(db, request.data);
            wake();
            break;
          case 'read':
            data = await view(db, request.data);
            break;
          case 'vocabulary': {
            const s = await settings();
            data = {
              words: await db.vocabulary.toArray(),
              gesture: s.gesture,
              theme: s.theme,
              excludedLanguages: s.excludedLanguages,
              configured: !!s.apiKey || new URL(s.baseUrl).hostname !== 'api.deepseek.com',
            };
            break;
          }
          case 'settings':
            data = await settings();
            break;
          case 'saveSettings':
            await browser.storage.local.set({ settings: request.data });
            await db.jobs
              .filter((j) => j.kind === 'generate' || !j.blocked)
              .modify({ nextAt: 0, blocked: false });
            wake();
            break;
          case 'models':
            data = await availableModels(request.data);
            break;
          case 'testAnki':
            data = await new Anki({ ...request.data, deck: '' }).testConnection();
            break;
          case 'testModel': {
            const started = Date.now();
            await explain(request.data, {
              url: 'https://example.org/',
              title: '',
              sentence: 'She was reluctant to ask for help.',
              start: 8,
              end: 17,
              location: '',
            });
            data = { elapsedMs: Date.now() - started };
            break;
          }
          case 'open':
            await browser.runtime.openOptionsPage();
            break;
          case 'list': {
            const captures = await db.captures.orderBy('createdAt').reverse().toArray();
            const records = await Promise.all(captures.filter((c) => !c.deleted).map((c) => view(db, c.id)));
            // Removing the last source must not hide the surviving learning entry.
            for (const entry of await db.entries.toArray()) {
              if (entry.deleted || records.some((r) => r?.entry?.id === entry.id)) continue;
              const source = captures.find((c) => c.entryId === entry.id);
              if (source) records.push(await view(db, source.id, true));
            }
            data = { records: records.filter(Boolean), jobs: await db.jobs.toArray() };
            break;
          }
          case 'state':
            await db.vocabulary.update(request.data.id, { state: request.data.state });
            break;
          case 'retry': {
            await db.jobs.update(request.data, {
              nextAt: 0,
              leaseUntil: 0,
              blocked: false,
              token: crypto.randomUUID(),
            });
            wake();
            break;
          }
          case 'remove':
            await removeEntry(db, request.data.id, request.data.anki);
            wake();
            break;
          case 'removeSource':
            await db.transaction('rw', db.captures, db.jobs, async () => {
              const c = await db.captures.get(request.data);
              await db.captures.update(request.data, { deleted: true });
              await db.jobs.delete(`generate:${request.data}`);
              if (c?.entryId) await queue(db, 'export', c.entryId);
            });
            wake();
            break;
          case 'edit': {
            const entry = await db.entries.get(request.data.id);
            if (!entry || entry.deleted) throw new Error('该条目已删除');
            const old = await db.generations.get(entry.generationId);
            const c = old && (await db.captures.get(old.captureId));
            if (!c) throw new Error('未找到原始语境');
            const material = validateMaterial(request.data.material, c.source);
            if (material.language !== old!.material.language || material.lemma !== old!.material.lemma)
              throw new Error('编辑仅用于纠正释义与例句');
            await db.transaction('rw', db.generations, db.entries, db.jobs, async () => {
              const id = crypto.randomUUID();
              await db.generations.add({ id, captureId: c.id, material, createdAt: Date.now() });
              await db.entries.update(entry.id, { generationId: id });
              await queue(db, 'export', entry.id);
            });
            wake();
            break;
          }
        }
        return { ok: true, data };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error && error.name !== 'ZodError' ? error.message : '输入内容不符合要求',
        };
      }
    })();
  });
  wake();
});
