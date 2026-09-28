import { browser } from 'wxt/browser';
import { z } from 'zod';
import {
  materialSchema,
  settingsSchema,
  sourceSchema,
  type RecordView,
  type Vocabulary,
  type Job,
} from './domain/model';
import type { RecordDetail, RecordPage } from './domain/records';
import { syncSettingsSchema, type SyncStatus } from './domain/sync';
import { wordlistImport, wordlistMode, type Wordlist, type ReadingWord } from './domain/wordlists';

export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lookup'), data: sourceSchema }),
  z.object({ type: z.literal('read'), data: z.string().max(100) }),
  z.object({ type: z.literal('vocabulary'), data: z.array(z.string().max(200)).max(1000).default([]) }),
  z.object({ type: z.literal('readingSettings') }),
  z.object({ type: z.literal('readingWords'), data: z.array(z.string().max(200)).max(1000) }),
  z.object({ type: z.literal('wordlists') }),
  z.object({ type: z.literal('importWordlist'), data: wordlistImport }),
  z.object({
    type: z.literal('changeWordlist'),
    data: z.object({
      id: z.string().max(100),
      enabled: z.boolean().optional(),
      mode: wordlistMode.optional(),
      remove: z.boolean().default(false),
    }),
  }),
  z.object({
    type: z.literal('list'),
    data: z
      .object({
        query: z.string().max(200).default(''),
        offset: z.int().min(0).default(0),
        examples: z.boolean().default(false),
        before: z.tuple([z.number(), z.string()]).optional(),
      })
      .default({ query: '', offset: 0, examples: false }),
  }),
  z.object({
    type: z.literal('detail'),
    data: z.object({ id: z.string().max(150), offset: z.int().nonnegative().default(0) }),
  }),
  z.object({ type: z.literal('pendingDeletes') }),
  z.object({ type: z.literal('settings') }),
  z.object({ type: z.literal('syncStatus') }),
  z.object({ type: z.literal('syncNow') }),
  z.object({ type: z.literal('testSync'), data: syncSettingsSchema }),
  z.object({ type: z.literal('open') }),
  z.object({ type: z.literal('saveSettings'), data: settingsSchema }),
  z.object({ type: z.literal('models'), data: settingsSchema.pick({ baseUrl: true, apiKey: true }) }),
  z.object({
    type: z.literal('testModel'),
    data: settingsSchema.pick({ baseUrl: true, apiKey: true, model: true, prompt: true }),
  }),
  z.object({ type: z.literal('testAnki'), data: settingsSchema.pick({ ankiUrl: true, ankiKey: true }) }),
  z.object({
    type: z.literal('state'),
    data: z.object({ id: z.string(), state: z.enum(['known', 'learning']) }),
  }),
  z.object({ type: z.literal('retry'), data: z.string().max(150) }),
  z.object({ type: z.literal('remove'), data: z.object({ id: z.string(), anki: z.boolean() }) }),
  z.object({ type: z.literal('removeSource'), data: z.string().max(100) }),
  z.object({ type: z.literal('edit'), data: z.object({ id: z.string(), material: materialSchema }) }),
]);
export type Request = z.input<typeof requestSchema>;
type Results = {
  lookup: string;
  read: RecordView | undefined;
  vocabulary: Vocabulary[];
  readingWords: ReadingWord[];
  wordlists: Wordlist[];
  importWordlist: string;
  changeWordlist: void;
  readingSettings: {
    gesture: 'click' | 'alt';
    configured: boolean;
    theme: 'auto' | 'light' | 'dark';
    excludedLanguages: string[];
  };
  list: RecordPage;
  detail: RecordDetail | undefined;
  pendingDeletes: Job[];
  settings: z.infer<typeof settingsSchema>;
  syncStatus: SyncStatus;
  syncNow: SyncStatus;
  testSync: void;
  saveSettings: void;
  models: string[];
  testModel: { elapsedMs: number };
  testAnki: { version: number };
  open: void;
  state: void;
  retry: void;
  remove: void;
  removeSource: void;
  edit: void;
};
export async function send<T extends Request['type']>(
  request: Extract<Request, { type: T }>,
  signal?: AbortSignal,
): Promise<Results[T]> {
  const response = (await (signal
    ? cancellableRequest(request, signal)
    : browser.runtime.sendMessage(request))) as {
    ok: boolean;
    data: Results[T];
    error?: string;
  };
  if (!response?.ok) throw new Error(response?.error || '扩展连接已断开，请刷新页面');
  return response.data;
}

function cancellableRequest(request: Request, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: 'request' });
    let finished = false;
    const finish = (value?: unknown, error?: unknown) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      port.disconnect();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(undefined, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    port.onMessage.addListener((value) => finish(value));
    port.onDisconnect.addListener(() => finish(undefined, new Error('扩展连接已断开')));
    port.postMessage(request);
  });
}

export type Change = {
  records?: boolean;
  vocabulary?: boolean;
  settings?: boolean;
  sync?: boolean;
  wordlists?: boolean;
  initial?: boolean;
  revision?: string;
};
// Reconnect only while visible. A reconnect always reads a fresh bounded snapshot.
export function subscribeChanges(listener: (change: Change) => void) {
  let port: ReturnType<typeof browser.runtime.connect> | undefined;
  let closed = false,
    retry: ReturnType<typeof setTimeout> | undefined;
  let lastRevision: string | undefined;
  const connect = () => {
    if (closed || document.hidden || port) return;
    const connected = browser.runtime.connect({ name: 'changes' });
    port = connected;
    connected.onMessage.addListener((change: Change) => {
      if (change.initial && change.revision === lastRevision && lastRevision !== undefined) return;
      lastRevision = change.revision;
      listener(change);
    });
    connected.onDisconnect.addListener(() => {
      if (port && port !== connected) return;
      port = undefined;
      if (!closed && !document.hidden) retry = setTimeout(connect, 1000);
    });
  };
  const visibility = () => {
    if (document.hidden) {
      clearTimeout(retry);
      const old = port;
      port = undefined;
      old?.disconnect();
    } else connect();
  };
  document.addEventListener('visibilitychange', visibility);
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    document.removeEventListener('visibilitychange', visibility);
    port?.disconnect();
  };
}
