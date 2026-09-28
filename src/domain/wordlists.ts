import { z } from 'zod';
import type { Lifecycle } from './sync';

export const wordlistMode = z.enum(['exclude', 'include']);
export const wordlistImport = z.object({
  name: z.string().trim().min(1).max(120),
  mode: wordlistMode.default('exclude'),
  terms: z.array(z.string().trim().min(1).max(150)).min(1).max(100000),
});
export type Wordlist = Lifecycle & {
  id: string;
  name: string;
  mode: z.infer<typeof wordlistMode>;
  enabled: boolean;
  count: number;
  createdAt: number;
  deleted?: boolean;
};
export type WordlistContent = { id: string; terms: string[] };
export type WordlistWord = { listId: string; term: string };
export type ReadingWord = { form: string; state?: 'known' | 'learning'; suppressed: boolean };
