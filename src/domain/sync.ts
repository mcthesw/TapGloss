import { z } from 'zod';

export const syncSettingsSchema = z
  .object({
    backend: z.enum(['off', 's3', 'webdav']).default('off'),
    endpoint: z.string().max(2000).default(''),
    workspace: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .default('default'),
    bucket: z.string().max(255).default(''),
    region: z.string().max(100).default('us-east-1'),
    username: z.string().max(500).default(''),
    password: z.string().max(4096).default(''),
  })
  .superRefine((s, ctx) => {
    if (s.backend === 'off') return;
    try {
      const url = new URL(s.endpoint);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
    } catch {
      ctx.addIssue({ code: 'custom', message: '请填写有效的同步地址', path: ['endpoint'] });
    }
    if (s.backend === 's3' && !s.bucket.trim())
      ctx.addIssue({ code: 'custom', message: '请填写存储桶', path: ['bucket'] });
  });
export type SyncSettings = z.infer<typeof syncSettingsSchema>;
export type SyncStatus = { running: boolean; lastSuccess?: number; error?: string };

// Acknowledgements permit explicit restoration, without resurrecting an unseen concurrent deletion.
export type Lifecycle = { deletions?: string[]; acknowledged?: string[] };
export function deleted(value: Lifecycle) {
  return (value.deletions ?? []).some((token) => !value.acknowledged?.includes(token));
}
export function deletion(value: Lifecycle) {
  return { deletions: [...(value.deletions ?? []), crypto.randomUUID()], deleted: true };
}
