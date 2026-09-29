import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { builtinWordlists, downloadBuiltin } from '../src/wordlists/builtin';
import { Database } from '../src/storage/database';
import { importWordlist, changeWordlist, readingWords } from '../src/storage/wordlists';
it('checks every pinned snapshot and rejects corrupt downloads before importing', async () => {
  for (const item of builtinWordlists) {
    const text = readFileSync(`resources/wordlists/${item.id}.txt`, 'utf8');
    const result = await downloadBuiltin(item.id, undefined, async () => new Response(text));
    expect(result.terms).toHaveLength(item.count);
    expect(new Set(result.terms).size).toBe(item.count);
  }
  await expect(downloadBuiltin('cet4', undefined, async () => new Response('corrupt'))).rejects.toThrow(
    '校验失败',
  );
  await expect(
    downloadBuiltin('cet4', undefined, async () => new Response('', { status: 503 })),
  ).rejects.toThrow('下载失败');
});
it('makes built-in imports idempotent and restores a removed baseline with inflections', async () => {
  const db = new Database(crypto.randomUUID());
  try {
    const item = builtinWordlists[0]!;
    const { terms } = await downloadBuiltin(
      item.id,
      undefined,
      async () => new Response(readFileSync('resources/wordlists/cet4.txt', 'utf8')),
    );
    const input = { name: item.name, terms };
    await Promise.all([
      importWordlist(db, input, item.wordlistId),
      importWordlist(db, input, item.wordlistId),
    ]);
    expect(await db.wordlists.count()).toBe(1);
    expect((await readingWords(db, ['accepted']))[0]?.suppressed).toBe(true);
    await changeWordlist(db, item.wordlistId, {}, true);
    expect((await readingWords(db, ['accepted']))[0]?.suppressed).toBe(false);
    await importWordlist(db, input, item.wordlistId);
    expect((await readingWords(db, ['accepted']))[0]?.suppressed).toBe(true);
  } finally {
    await db.delete();
  }
});
