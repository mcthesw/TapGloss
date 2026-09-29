import { afterEach, expect, it, vi } from 'vitest';
import { noteFields } from '../src/anki/client';
import { Database, capture, queue, view } from '../src/storage/database';
import { Worker } from '../src/storage/worker';
import { source, material, settings, fakeServices } from './fixtures';
import type { Entry } from '../src/domain/model';
afterEach(() => vi.unstubAllGlobals());
it('hints only single Latin words of four or more characters and escapes content', () => {
  const entry = { id: 'test' } as Entry;
  for (const [word, hint] of [
    ['repository', 'r…'],
    ['élève', 'é…'],
    ['cat', ''],
    ['take off', ''],
    ['学习表达', ''],
    ['B2B', ''],
  ] as const) {
    const value = { ...material, examples: [{ text: `Say ${word}.`, target: word }] };
    const text = noteFields(entry, value, [], true).Text;
    expect(text).toContain(`{{c1::${word}${hint ? '::' + hint : ''}}}`);
  }
});
it('freezes the new-note preference across setting changes and leaves legacy cards unchanged', async () => {
  const db = new Database(crypto.randomUUID());
  const services = fakeServices();
  vi.stubGlobal('fetch', services.fetcher);
  try {
    const id = await capture(db, source);
    await new Worker(db, async () => ({ ...settings, clozeFirstLetter: true })).run();
    expect(services.notes.get(1)!.fields.Text).toContain('::reluctant::r…');
    const entry = (await view(db, id))!.entry!;
    await queue(db, 'export', entry.id);
    await new Worker(db, async () => ({ ...settings, clozeFirstLetter: false })).run();
    expect(services.notes.get(1)!.fields.Text).toContain('::reluctant::r…');
    // Model a pre-feature local binding and its unhinted note.
    const text = noteFields(entry, material, []).Text;
    services.notes.get(1)!.fields.Text = text;
    const { hash } = await import('../src/domain/model');
    await db.ankiBindings.update(entry.id, {
      clozeFirstLetter: undefined,
      syncedHash: await hash(services.notes.get(1)!.fields),
    });
    await queue(db, 'export', entry.id);
    await new Worker(db, async () => ({ ...settings, clozeFirstLetter: true })).run();
    expect(services.notes.get(1)!.fields.Text).toBe(text);
    expect((await db.ankiBindings.get(entry.id))!.clozeFirstLetter).toBe(false);
  } finally {
    await db.delete();
  }
});
it('preserves hint choice when a successful creation loses its response', async () => {
  const db = new Database(crypto.randomUUID());
  const services = fakeServices();
  let lost = false;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const result = await services.fetcher(input, init);
    if (JSON.parse(String(init.body)).action === 'addNote' && !lost) {
      lost = true;
      throw new TypeError('connection lost');
    }
    return result;
  });
  try {
    const id = await capture(db, source);
    await new Worker(db, async () => ({ ...settings, clozeFirstLetter: true })).run();
    await db.jobs.toCollection().modify({ nextAt: 0 });
    await new Worker(db, async () => ({ ...settings, clozeFirstLetter: false })).run();
    expect(services.notes.size).toBe(1);
    expect((await view(db, id))!.entry!.noteId).toBe(1);
    expect(services.notes.get(1)!.fields.Text).toContain('::reluctant::r…');
  } finally {
    await db.delete();
  }
});
