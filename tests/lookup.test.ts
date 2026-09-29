import { expect, it } from 'vitest';
import { isNumericExpression, isReadingExpression } from '../src/domain/expression';
import { Database, capture, view } from '../src/storage/database';
import { removeLookup } from '../src/storage/mutations';
import { Worker } from '../src/storage/worker';
import { source, settings, fakeServices } from './fixtures';
it('filters numeric expressions without excluding vocabulary containing digits', async () => {
  for (const value of ['5018', '５０１８', '١٢٣', '3.14', '1,000', '-42', '50%', '$10'])
    expect(isNumericExpression(value)).toBe(true);
  for (const value of ['B2', 'COVID-19', '第3章', 'take 2', '一百'])
    expect(isNumericExpression(value)).toBe(false);
  const db = new Database(crypto.randomUUID());
  try {
    await expect(capture(db, { ...source, sentence: '5018', start: 0, end: 4 })).rejects.toThrow('纯数字');
    expect(await db.captures.count()).toBe(0);
    expect(await db.jobs.count()).toBe(0);
  } finally {
    await db.delete();
  }
});
it('deletes pending lookups and resolves entries generated before confirmation', async () => {
  const db = new Database(crypto.randomUUID());
  const original = globalThis.fetch;
  const services = fakeServices();
  globalThis.fetch = services.fetcher as typeof fetch;
  try {
    const id = await capture(db, source);
    await removeLookup(db, id, false);
    expect(await view(db, id)).toBeUndefined();
    expect(await db.jobs.count()).toBe(0);
    await capture(db, source);
    await new Worker(db, async () => settings).run();
    expect(services.notes.size).toBe(1);
    await removeLookup(db, id, true);
    await new Worker(db, async () => settings).run();
    expect(await view(db, id)).toBeUndefined();
    expect(services.notes.size).toBe(0);
  } finally {
    globalThis.fetch = original;
    await db.delete();
  }
});

it('suppresses single Latin letters only at the passive reading boundary', () => {
  for (const value of ['a', 'I', 'à', 'e\u0301', 'Ａ', 'x', '5018'])
    expect(isReadingExpression(value), value).toBe(false);
  for (const value of ['我', '猫', 'の', '나', 'я', 'an', 'B2', 'a word'])
    expect(isReadingExpression(value), value).toBe(true);
  expect(isNumericExpression('I')).toBe(false);
});
