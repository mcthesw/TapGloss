import { createReadingControls } from '../src/reading/controls';
import { readingEnabled } from '../src/domain/reading';
import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { settingsSchema, normalize } from '../src/domain/model';
import { Database, capture, removeEntry, view, setVocabularyState } from '../src/storage/database';
import { Worker } from '../src/storage/worker';
import { requestSchema, type Change } from '../src/messages';
import { availableModels, explain } from '../src/explain/client';
import { Anki } from '../src/anki/client';
import { listRecords, recordDetail } from '../src/storage/catalog';
import { editMaterial, removeSource, removeLookup } from '../src/storage/mutations';
import { SyncService, testRemote } from '../src/sync/service';
import { importWordlist, changeWordlist, readingWords } from '../src/storage/wordlists';

export default defineBackground(() => {
  const db = new Database();
  // Large one-time IndexedDB upgrades can exceed MV3's idle timeout. Stop as soon as opening finishes.
  const opening = setInterval(() => {
    void browser.runtime.getPlatformInfo();
  }, 20000);
  void db
    .open()
    .finally(() => clearInterval(opening))
    .catch(() => {});
  const settings = async () =>
    settingsSchema.parse((await browser.storage.local.get('settings')).settings ?? {});
  const subscribers = new Set<ReturnType<typeof browser.runtime.connect>>();
  let pending: Change = {},
    timer: ReturnType<typeof setTimeout> | undefined;
  const notify = (change: Change) => {
    pending = { ...pending, ...change };
    if (timer) return;
    timer = setTimeout(async () => {
      const message = pending;
      pending = {};
      timer = undefined;
      message.revision = crypto.randomUUID();
      await browser.storage.session.set({ changeRevision: message.revision });
      for (const port of subscribers) {
        try {
          port.postMessage(message);
        } catch {
          subscribers.delete(port);
        }
      }
    }, 30);
  };
  const controls = createReadingControls(() => notify({ settings: true }));
  const worker = new Worker(db, settings, (vocabulary) =>
    notify({ records: true, ...(vocabulary ? { vocabulary: true } : {}) }),
  );
  let waking: Promise<void> | undefined;
  const wake = () =>
    (waking ??= (async () => {
      await worker.run();
      const next = await db.jobs
        .orderBy('nextAt')
        .filter((j) => !j.blocked)
        .first();
      if (next)
        await browser.alarms.create('work', {
          when: Math.max(Date.now() + 1000, next.nextAt, next.leaseUntil),
        });
      else await browser.alarms.clear('work');
    })()
      .catch(() => {
        void browser.alarms.create('work', { when: Date.now() + 60000 });
      })
      .finally(() => {
        waking = undefined;
      }));
  const sync = new SyncService(db, async () => (await settings()).sync, {
    changed: () => notify({ sync: true }),
    recordsChanged: () => notify({ records: true, vocabulary: true, wordlists: true }),
    jobs: () => {
      void wake();
    },
    schedule: async (when, preserve) => {
      if (when && preserve && (await browser.alarms.get('sync'))) return;
      if (when) await browser.alarms.create('sync', { when });
      else await browser.alarms.clear('sync');
    },
  });
  const syncReady = sync.initialize();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'work') void wake();
    if (alarm.name === 'sync') void syncReady.then(() => sync.run()).catch(() => {});
  });
  browser.runtime.onStartup.addListener(() => {
    void wake();
  });
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void browser.runtime.openOptionsPage();
    void wake();
  });

  const handle = async (raw: unknown, sender: { id?: string; url?: string }, signal?: AbortSignal) => {
    if (sender.id !== browser.runtime.id) return { ok: false, error: '无效来源' };
    try {
      const request = requestSchema.parse(raw);
      const trusted = sender.url?.startsWith(browser.runtime.getURL('/'));
      if (
        !trusted &&
        ![
          'lookup',
          'read',
          'vocabulary',
          'readingWords',
          'readingSettings',
          'state',
          'open',
          'removeLookup',
        ].includes(request.type)
      )
        throw new Error('此操作只能在扩展页面中进行');
      let data: unknown;
      let change: Change | undefined;
      let runJobs = false;
      switch (request.type) {
        case 'lookup':
          if (!readingEnabled(await controls.read(), request.data.url)) throw new Error('阅读功能已暂停');
          data = await capture(db, request.data);
          change = { records: true };
          runJobs = true;
          break;
        case 'read':
          data = await view(db, request.data);
          break;
        case 'detail':
          data = await recordDetail(db, request.data.id, request.data.offset);
          break;
        case 'list':
          data = await listRecords(
            db,
            request.data.query,
            request.data.offset,
            request.data.examples,
            request.data.before,
          );
          break;
        case 'pendingDeletes':
          data = await db.jobs.where('kind').equals('delete').limit(100).toArray();
          break;
        case 'vocabulary':
          data = request.data.length
            ? await db.vocabulary.where('forms').anyOf(request.data.map(normalize)).distinct().toArray()
            : [];
          break;
        case 'readingControls':
          data = await controls.read();
          break;
        case 'changeReadingControls':
          data = await controls.change(request.data);
          break;
        case 'readingSettings': {
          const s = await settings();
          data = {
            enabled: readingEnabled(await controls.read(), sender.url),
            gesture: s.gesture,
            theme: s.theme,
            interfaceLanguage: s.interfaceLanguage,
            excludedLanguages: s.excludedLanguages,
            configured: !!s.apiKey || new URL(s.baseUrl).hostname !== 'api.deepseek.com',
          };
          break;
        }
        case 'settings':
          data = await settings();
          break;
        case 'readingWords':
          data = await readingWords(db, request.data);
          break;
        case 'wordlists':
          data = await db.wordlists
            .orderBy('createdAt')
            .reverse()
            .filter((l) => !l.deleted)
            .toArray();
          break;
        case 'importWordlist':
          data = await importWordlist(db, request.data);
          change = { wordlists: true, vocabulary: true };
          break;
        case 'changeWordlist': {
          const { id, remove, ...patch } = request.data;
          await changeWordlist(db, id, patch, remove);
          change = { wordlists: true, vocabulary: true };
          break;
        }
        case 'syncStatus':
          data = await sync.status();
          break;
        case 'syncNow':
          await syncReady;
          data = await sync.run();
          break;
        case 'testSync':
          await testRemote(request.data, signal);
          break;
        case 'saveSettings': {
          const before = await settings();
          if (JSON.stringify(before) !== JSON.stringify(request.data)) {
            await browser.storage.local.set({ settings: request.data });
            await syncReady;
            await sync.configure(request.data.sync);
            change = { settings: true };
          }
          break;
        }
        case 'models':
          data = await availableModels(request.data, signal);
          break;
        case 'testAnki':
          data = await new Anki({ ...request.data, deck: '' }).testConnection(signal);
          break;
        case 'testModel': {
          const started = Date.now();
          await explain(
            request.data,
            {
              url: 'https://example.org/',
              title: '',
              sentence: 'She was reluctant to ask for help.',
              start: 8,
              end: 17,
              location: '',
            },
            signal,
          );
          data = { elapsedMs: Date.now() - started };
          break;
        }
        case 'open':
          await browser.runtime.openOptionsPage();
          break;
        case 'state':
          await setVocabularyState(db, request.data.id, request.data.state);
          change = { records: true, vocabulary: true };
          break;
        case 'retry': {
          const job = await db.jobs.get(request.data);
          if (job && job.leaseUntil > Date.now()) throw new Error('任务正在进行');
          if (job)
            await db.jobs.update(job.id, {
              nextAt: 0,
              leaseUntil: 0,
              blocked: false,
              attempts: 0,
              error: undefined,
              token: crypto.randomUUID(),
            });
          change = { records: true };
          runJobs = true;
          break;
        }
        case 'remove':
          await removeEntry(db, request.data.id, request.data.anki);
          change = { records: true };
          runJobs = true;
          break;
        case 'removeLookup':
          await removeLookup(db, request.data.id, request.data.anki);
          change = { records: true };
          runJobs = true;
          break;
        case 'removeSource':
          await removeSource(db, request.data);
          change = { records: true };
          runJobs = true;
          break;
        case 'edit':
          await editMaterial(db, request.data.id, request.data.material);
          change = { records: true };
          runJobs = true;
          break;
      }
      if (change) notify(change);
      if (runJobs) void wake();
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error && error.name !== 'ZodError' ? error.message : '输入或返回内容不符合要求',
      };
    }
  };
  browser.runtime.onMessage.addListener((raw, sender) => handle(raw, sender));
  browser.runtime.onConnect.addListener((port) => {
    if (port.sender?.id !== browser.runtime.id) {
      port.disconnect();
      return;
    }
    if (port.name === 'changes') {
      subscribers.add(port);
      void browser.storage.session.get('changeRevision').then((stored) => {
        if (subscribers.has(port))
          port.postMessage({ initial: true, revision: stored.changeRevision ?? 'initial' });
      });
      port.onDisconnect.addListener(() => subscribers.delete(port));
    } else if (port.name === 'request') {
      const controller = new AbortController();
      port.onDisconnect.addListener(() => controller.abort());
      port.onMessage.addListener((request) => {
        void handle(request, port.sender ?? {}, controller.signal).then((result) => {
          if (!controller.signal.aborted) port.postMessage(result);
        });
      });
    } else port.disconnect();
  });
  void wake();
  void syncReady.catch(() => {});
});
