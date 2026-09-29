import { z } from 'zod';
import { languageCodes } from './languages';
import { syncSettingsSchema, type Lifecycle } from './sync';

const httpUrl = z.url().refine((s) => /^https?:\/\//.test(s), '请输入 HTTP 或 HTTPS 地址');
export const settingsSchema = z.object({
  baseUrl: httpUrl.default('https://api.deepseek.com'),
  apiKey: z.string().max(4096).default(''),
  model: z.string().trim().min(1).max(200).default('deepseek-flash'),
  ankiUrl: httpUrl.default('http://127.0.0.1:8765'),
  ankiKey: z.string().max(4096).default(''),
  clozeFirstLetter: z.boolean().default(true),
  deck: z.string().trim().min(1).max(200).default('TapGloss'),
  prompt: z.string().max(12000).default(''),
  theme: z.enum(['auto', 'light', 'dark']).default('auto'),
  interfaceLanguage: z.enum(['auto', 'zh', 'en']).default('auto'),
  gesture: z.enum(['click', 'alt']).default('click'),
  excludedLanguages: z.array(z.enum(languageCodes)).max(languageCodes.length).default([]),
  sync: syncSettingsSchema.default(() => syncSettingsSchema.parse({})),
});
export type Settings = z.infer<typeof settingsSchema>;
export const sourceSchema = z
  .object({
    url: httpUrl,
    title: z.string().max(500),
    sentence: z.string().min(1).max(6000),
    start: z.int().nonnegative(),
    end: z.int().positive(),
    location: z.string().max(160),
  })
  .refine((s) => s.start < s.end && s.end <= s.sentence.length, '选中范围无效');
export type Source = z.infer<typeof sourceSchema>;
export const exampleSchema = z.object({
  text: z.string().min(1).max(600),
  target: z.string().min(1).max(150),
});
export const materialSchema = z.object({
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/),
  lemma: z.string().trim().min(1).max(150),
  sense: z.string().min(1).max(300),
  gloss: z.string().max(400),
  sourceTarget: z.string().min(1).max(200),
  sourceOccurrence: z.int().nonnegative(),
  examples: z.array(exampleSchema).length(3),
});
export type Material = z.infer<typeof materialSchema>;
export type Generation = { id: string; captureId: string; material: Material; createdAt: number };
export type Capture = Lifecycle & {
  id: string;
  source: Source;
  createdAt: number;
  entryId?: string;
  deleted?: boolean;
  restoreDeletions?: string[];
};
export type Entry = Lifecycle & {
  id: string;
  language: string;
  lemma: string;
  sense: string;
  generationId: string;
  createdAt: number;
  deleted?: boolean;
  deletedAt?: number;
};
export type AnkiBinding = {
  id: string;
  noteId?: number;
  syncedHash?: string;
  pendingHash?: string;
  clozeFirstLetter?: boolean;
};
export type Vocabulary = {
  id: string;
  language: string;
  lemma: string;
  forms: string[];
  state: 'learning' | 'known';
};
export type Job = {
  id: string;
  kind: 'generate' | 'export' | 'delete';
  ref: string;
  token: string;
  attempts: number;
  nextAt: number;
  leaseUntil: number;
  error?: string;
  blocked?: boolean;
};
export type RecordView = {
  capture: Capture;
  entry?: Entry & Partial<AnkiBinding>;
  generation?: Generation;
  job?: Job;
  state?: Vocabulary['state'];
};
export const normalize = (s: string) => s.normalize('NFC').toLowerCase();
export const vocabularyId = (language: string, lemma: string) => `${language}:${normalize(lemma)}`;
export async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
export const captureId = (s: Source) => hash([s.url, s.location, s.sentence, s.start, s.end]);
export function validateMaterial(value: unknown, source: Source): Material {
  const m = materialSchema.parse(value);
  let position = -1;
  for (let i = 0; i <= m.sourceOccurrence; i++) {
    position = source.sentence.indexOf(m.sourceTarget, position + 1);
    if (position < 0) throw new Error('模型未正确定位原文，请重试');
  }
  if (position > source.start || position + m.sourceTarget.length < source.end)
    throw new Error('模型解释的表达未包含选中内容');
  for (const e of m.examples) {
    if (e.text.split(e.target).length !== 2 || /\{\{|\}\}/.test(e.text))
      throw new Error('例句的目标表达不明确，请重试');
  }
  return m;
}
