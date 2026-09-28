import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Database, capture, queue, removeEntry, view } from '../src/storage/database';
import { Worker } from '../src/storage/worker';
import { hash, validateMaterial, vocabularyId } from '../src/domain/model';
import { noteFields } from '../src/anki/client';
import { source, material, settings, fakeServices } from './fixtures';

describe('durable reading → Anki workflow', () => {
  let db: Database, services: ReturnType<typeof fakeServices>;
  const run = () => new Worker(db, async () => settings).run();
  beforeEach(() => {
    db = new Database(crypto.randomUUID());
    services = fakeServices();
    vi.stubGlobal('fetch', services.fetcher);
  });
  afterEach(async () => {
    await db.delete();
    vi.unstubAllGlobals();
  });
  it('reuses the same occurrence across restarts and produces one three-cloze card', async () => {
    const id = await capture(db, source);
    await run();
    await capture(db, source);
    await run();
    expect(services.counts()).toEqual({ generations: 1, adds: 1 });
    expect((await view(db, id))?.entry?.noteId).toBe(1);
    expect(services.notes.get(1)?.fields.Text?.match(/\{\{c1::/g)).toHaveLength(3);
    expect(await db.jobs.count()).toBe(0);
  });
  it('keeps the original generation and appends new contexts to the same sense', async () => {
    await capture(db, source);
    await run();
    const first = (await db.entries.toArray())[0]!;
    await db.vocabulary.update(vocabularyId('en', 'reluctant'), { state: 'known' });
    await capture(db, { ...source, url: 'https://example.org/second' });
    await run();
    expect(await db.captures.count()).toBe(2);
    expect(await db.entries.count()).toBe(1);
    expect((await db.entries.get(first.id))?.generationId).toBe(first.generationId);
    expect(services.counts().adds).toBe(1);
    expect(services.notes.get(1)?.fields.Extra?.match(/<blockquote>/g)).toHaveLength(2);
    expect((await db.vocabulary.toArray())[0]?.state).toBe('known');
  });
  it('recovers an ambiguous add timeout without a second note', async () => {
    services.loseNextAdd();
    await capture(db, source);
    await run();
    expect(await db.jobs.count()).toBe(1);
    await db.jobs.toCollection().modify({ nextAt: 0 });
    await run();
    expect(services.counts().adds).toBe(1);
    expect((await db.ankiBindings.toArray())[0]?.noteId).toBe(1);
  });
  it('pauses permanent model errors and bounds retries for temporary failures', async () => {
    vi.stubGlobal('fetch', async () => Response.json({}, { status: 400 }));
    await capture(db, source);
    await run();
    expect((await db.jobs.toArray())[0]?.blocked).toBe(true);
    await db.jobs.clear();
    await db.captures.clear();
    vi.stubGlobal('fetch', async () => Response.json({}, { status: 503 }));
    await capture(db, source);
    for (let i = 0; i < 5; i++) {
      await db.jobs.toCollection().modify({ nextAt: 0 });
      await run();
    }
    const job = (await db.jobs.toArray())[0]!;
    expect(job.attempts).toBe(5);
    expect(job.blocked).toBe(true);
  });
  it('keeps generated material when Anki is offline and resumes after restart', async () => {
    services.offline(true);
    const id = await capture(db, source);
    await run();
    expect((await view(db, id))?.generation?.material.examples).toHaveLength(3);
    services.offline(false);
    await db.jobs.toCollection().modify({ nextAt: 0 });
    await run();
    expect(services.notes.size).toBe(1);
  });
  it('does not overwrite a manual Anki edit', async () => {
    await capture(db, source);
    await run();
    services.notes.get(1)!.fields.Extra = 'My personal correction';
    await capture(db, { ...source, url: 'https://example.org/other' });
    await run();
    expect(services.notes.get(1)!.fields.Extra).toBe('My personal correction');
    expect((await db.jobs.toArray())[0]?.blocked).toBe(true);
  });
  it('does not recreate an associated note removed outside TapGloss', async () => {
    await capture(db, source);
    await run();
    services.notes.clear();
    await capture(db, { ...source, url: 'https://example.org/again' });
    await run();
    expect(services.counts().adds).toBe(1);
    expect((await db.jobs.toArray())[0]?.error).toContain('已移除');
  });
  it('retains Anki by default and reuses its identity after an explicit new lookup', async () => {
    await capture(db, source);
    await run();
    const entry = (await db.entries.toArray())[0]!;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    await removeEntry(db, entry.id, false);
    await run();
    expect(services.notes.size).toBe(1);
    await capture(db, source);
    await run();
    expect(services.counts().adds).toBe(1);
    expect((await db.entries.get(entry.id))?.deleted).toBe(false);
    clock.mockRestore();
  });
  it('optional deletion only removes its owned note', async () => {
    await capture(db, source);
    await run();
    const entry = (await db.entries.toArray())[0]!;
    services.notes.set(999, { modelName: 'Personal', fields: { TapGlossId: 'unrelated' }, tags: [] });
    await removeEntry(db, entry.id, true);
    await run();
    expect([...services.notes.keys()]).toEqual([999]);
    expect((await db.captures.toArray())[0]?.deleted).toBe(true);
  });
  it('refuses to delete a note with a removed ownership marker', async () => {
    await capture(db, source);
    await run();
    const entry = (await db.entries.toArray())[0]!;
    services.notes.get(1)!.tags = [];
    await removeEntry(db, entry.id, true);
    await run();
    expect(services.notes.size).toBe(1);
    expect((await db.jobs.toArray())[0]?.blocked).toBe(true);
  });
  it('preserves a newer queued export when an older operation finishes', async () => {
    await capture(db, source);
    await run();
    const entry = (await db.entries.toArray())[0]!;
    await queue(db, 'export', entry.id);
    let injected = false;
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      if (!injected && JSON.parse(String(init.body)).action === 'findNotes') {
        injected = true;
        await queue(db, 'export', entry.id);
      }
      return services.fetcher(input, init);
    });
    await run();
    expect(await db.jobs.count()).toBe(0);
    expect(services.counts().adds).toBe(1);
  });
  it('does not resurrect a deleted entry when an in-flight generation finishes', async () => {
    await capture(db, source);
    await run();
    const entry = (await db.entries.toArray())[0]!;
    let removed = false;
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      if (!removed && input.includes('chat/completions')) {
        removed = true;
        await removeEntry(db, entry.id, false);
      }
      return services.fetcher(input, init);
    });
    await capture(db, { ...source, url: 'https://example.org/in-flight' });
    await run();
    expect((await db.entries.get(entry.id))?.deleted).toBe(true);
    expect(services.counts().adds).toBe(1);
  });
  it('keeps distinct senses of the same expression in separate notes', async () => {
    await capture(db, source);
    await run();
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.messages?.[0]?.content.startsWith('Match the contextual sense'))
        return Response.json({ choices: [{ message: { content: '{"id":null}' } }] });
      return services.fetcher(input, init);
    });
    await capture(db, { ...source, url: 'https://example.org/another-sense' });
    await run();
    expect(await db.entries.count()).toBe(2);
    expect(services.counts().adds).toBe(2);
  });
});

describe('untrusted learning material', () => {
  it('rejects an ambiguous target and an unrelated selected occurrence', () => {
    expect(() =>
      validateMaterial(
        {
          ...material,
          examples: [{ text: 'reluctant and reluctant', target: 'reluctant' }, ...material.examples.slice(1)],
        },
        source,
      ),
    ).toThrow();
    expect(() => validateMaterial({ ...material, sourceTarget: 'She' }, source)).toThrow();
  });
  it('escapes HTML and cloze syntax in user content', async () => {
    const malicious = { ...material, lemma: '<img src=x>', gloss: '{{c2::oops}}' };
    const entry = {
      id: 'safe',
      language: 'en',
      lemma: 'reluctant',
      sense: 'unwilling',
      generationId: 'g',
      createdAt: 0,
    };
    const values = noteFields(entry, malicious, [
      {
        id: 'c',
        source: { ...source, title: '<script>', sentence: 'text <img onerror="evil">' },
        createdAt: 0,
      },
    ]);
    expect(values.Extra).not.toContain('<img');
    expect(values.Extra).not.toContain('{{c2::');
    expect(await hash(values)).toHaveLength(64);
  });
});
