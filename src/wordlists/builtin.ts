import catalog from '../../resources/wordlists/catalog.json';
const revision = '26b5c2fe4e8eff26f22b70786c89098bfdc7d9c5';
export const builtinWordlists = catalog.lists.map((list) => ({
  ...list,
  wordlistId: `builtin:ecdict:${list.id}:${list.sha256}`,
  url: `https://raw.githubusercontent.com/mcthesw/TapGloss/${revision}/resources/wordlists/${list.id}.txt`,
}));
export const builtinSource = `https://github.com/skywind3000/ECDICT/tree/${catalog.sourceRevision}`;
export async function downloadBuiltin(id: string, signal: AbortSignal | undefined, fetcher: typeof fetch) {
  const item = builtinWordlists.find((list) => list.id === id);
  if (!item) throw new Error('未找到内置词表');
  const response = await fetcher(item.url, {
    signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error('词表下载失败，请重试');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('词表下载失败，请重试');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > item.bytes) throw new Error('词表校验失败，请重试');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (size !== item.bytes || digest !== item.sha256) throw new Error('词表校验失败，请重试');
  const terms = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim().split('\n');
  if (terms.length !== item.count) throw new Error('词表校验失败，请重试');
  signal?.throwIfAborted();
  return { item, terms };
}
