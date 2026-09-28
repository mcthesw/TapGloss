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

export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lookup'), data: sourceSchema }),
  z.object({ type: z.literal('read'), data: z.string().max(100) }),
  z.object({ type: z.literal('vocabulary') }),
  z.object({ type: z.literal('list') }),
  z.object({ type: z.literal('settings') }),
  z.object({ type: z.literal('open') }),
  z.object({ type: z.literal('saveSettings'), data: settingsSchema }),
  z.object({ type: z.literal('models'), data: settingsSchema }),
  z.object({ type: z.literal('testModel'), data: settingsSchema }),
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
type Request = z.infer<typeof requestSchema>;
type Results = {
  lookup: string;
  read: RecordView | undefined;
  vocabulary: {
    words: Vocabulary[];
    gesture: 'click' | 'alt';
    configured: boolean;
    theme: 'auto' | 'light' | 'dark';
    excludedLanguages: string[];
  };
  list: { records: RecordView[]; jobs: Job[] };
  settings: z.infer<typeof settingsSchema>;
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
): Promise<Results[T]> {
  const response = (await browser.runtime.sendMessage(request)) as {
    ok: boolean;
    data: Results[T];
    error?: string;
  };
  if (!response?.ok) throw new Error(response?.error || '扩展连接已断开，请刷新页面');
  return response.data;
}
