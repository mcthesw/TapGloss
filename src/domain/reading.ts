import { z } from 'zod';
export const readingControlsSchema = z.object({
  enabled: z.boolean().default(true),
  disabledSites: z.array(z.string().max(253)).max(10000).default([]),
});
export type ReadingControls = z.infer<typeof readingControlsSchema>;
export function siteHostname(url?: string) {
  try {
    const parsed = new URL(url ?? '');
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname : undefined;
  } catch {
    return undefined;
  }
}
export function readingEnabled(controls: ReadingControls, url?: string) {
  const host = siteHostname(url);
  return !!host && controls.enabled && !controls.disabledSites.includes(host);
}
