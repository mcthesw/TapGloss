import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../src/storage/database';
import { Worker } from '../src/storage/worker';
import { Anki, noteFields } from '../src/anki/client';
import { cardStyle, legacyCardStyle } from '../src/anki/template';
import { hash } from '../src/domain/model';
import { fakeServices, material, settings, source } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

it('upgrades stored notes in place while preserving deleted entries and blocked jobs', async () => {
  const name = crypto.randomUUID();
  const old = new Dexie(name);
  old.version(1).stores({
    captures: 'id,entryId,createdAt',
    entries: 'id,lemma,createdAt',
    generations: 'id,captureId',
    vocabulary: 'id',
    jobs: 'id,nextAt',
  });
  const entry = {
    id: 'owned',
    language: 'en',
    lemma: 'reluctant',
    sense: 'unwilling',
    generationId: 'g',
    createdAt: 1,
    noteId: 1,
  };
  const capture = { id: 'c', entryId: entry.id, source, createdAt: 1 };
  const oldFields = noteFields(entry, material, [capture]);
  oldFields.Extra = `<h2>reluctant</h2><p>not willing or eager</p>${material.examples.map((e) => `<p>${e.text}</p>`).join('')}`;
  await old.table('entries').bulkPut([
    { ...entry, syncedHash: await hash(oldFields) },
    { ...entry, id: 'deleted', deleted: true },
    { ...entry, id: 'blocked' },
  ]);
  await old.table('captures').put(capture);
  await old.table('generations').put({ id: 'g', captureId: 'c', material, createdAt: 1 });
  await old.table('jobs').put({
    id: 'export:blocked',
    kind: 'export',
    ref: 'blocked',
    token: 'original',
    blocked: true,
    attempts: 2,
    nextAt: 0,
    leaseUntil: 0,
  });
  old.close();
  const db = new Database(name);
  const services = fakeServices();
  services.notes.set(1, { fields: oldFields, tags: ['tapgloss'], modelName: 'TapGloss' });
  vi.stubGlobal('fetch', services.fetcher);
  try {
    await db.open();
    expect((await db.jobs.toArray()).map((j) => j.id).sort()).toEqual(['export:blocked', 'export:owned']);
    await new Worker(db, async () => settings).run();
    expect(services.notes.size).toBe(1);
    expect(services.counts().adds).toBe(0);
    expect((await db.entries.get('owned'))?.noteId).toBe(1);
    expect((await db.entries.get('deleted'))?.deleted).toBe(true);
    expect((await db.jobs.get('export:blocked'))?.token).toBe('original');
    expect(services.notes.get(1)?.fields.Extra).toContain('<details>');
    expect(services.notes.get(1)?.fields.Extra).not.toContain(material.examples[0]!.text);
  } finally {
    await db.delete();
  }
});

it.each([legacyCardStyle, '/* my custom theme */ .card{color:blue}'])(
  'only upgrades an unchanged shipped stylesheet',
  async (existing) => {
    const services = fakeServices();
    const updates: string[] = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.action === 'modelStyling') return Response.json({ result: { css: existing }, error: null });
      if (body.action === 'updateModelStyling') updates.push(body.params.model.css);
      return services.fetcher(input, init);
    });
    await new Anki(settings).setup();
    expect(updates).toEqual(existing === legacyCardStyle ? [cardStyle] : []);
  },
);
