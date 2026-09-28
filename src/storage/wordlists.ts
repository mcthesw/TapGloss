import type { z } from 'zod';
import Dexie from 'dexie';
import type { Database } from './database';
import { track } from './changes';
import { deletion } from '../domain/sync';
import { normalize } from '../domain/model';
import { wordlistImport, type Wordlist, type ReadingWord } from '../domain/wordlists';

export async function importWordlist(db: Database, input: z.input<typeof wordlistImport>) {
  const data = wordlistImport.parse(input);
  const terms = [...new Set(data.terms.map(normalize))];
  const list: Wordlist = {
    id: crypto.randomUUID(),
    name: data.name,
    mode: data.mode,
    enabled: true,
    count: terms.length,
    createdAt: Date.now(),
  };
  await db.transaction(
    'rw',
    [db.wordlists, db.wordlistContents, db.wordlistWords, db.syncChanges],
    async (tx) => {
      const content = { id: list.id, terms };
      await db.wordlists.add(list);
      await db.wordlistContents.add(content);
      await indexWordlist(db, list.id, terms);
      await track(tx, 'wordlists', undefined, list);
      await track(tx, 'wordlistContents', undefined, content);
    },
  );
  return list.id;
}

export async function indexWordlist(db: Database, id: string, terms: string[]) {
  await clearWordlistIndex(db, id);
  for (let i = 0; i < terms.length; i += 1000)
    await db.wordlistWords.bulkPut(terms.slice(i, i + 1000).map((term) => ({ listId: id, term })));
  await db.wordlistWords.put({ listId: id, term: '' });
}
export function clearWordlistIndex(db: Database, id: string) {
  return db.wordlistWords.where('[listId+term]').between([id, Dexie.minKey], [id, Dexie.maxKey]).delete();
}

export async function changeWordlist(
  db: Database,
  id: string,
  change: Partial<Pick<Wordlist, 'enabled' | 'mode'>>,
  remove = false,
) {
  await db.transaction('rw', [db.wordlists, db.wordlistWords, db.syncChanges], async (tx) => {
    const previous = await db.wordlists.get(id);
    if (!previous || previous.deleted) return;
    const next = { ...previous, ...change, ...(remove ? deletion(previous) : {}) };
    await db.wordlists.put(next);
    if (remove) await clearWordlistIndex(db, id);
    await track(tx, 'wordlists', previous, next);
  });
}

export async function readingWords(db: Database, input: string[]): Promise<ReadingWord[]> {
  const forms = [...new Set(input.map(normalize))];
  if (!forms.length) return [];
  return db.transaction('r', [db.vocabulary, db.wordlists, db.wordlistWords], async () => {
    const candidates = await db.wordlists.filter((l) => l.enabled && !l.deleted).toArray();
    const ready = await db.wordlistWords.bulkGet(candidates.map((l) => [l.id, '']));
    const lists = candidates.filter((_, i) => ready[i]);
    const [vocabulary, matches] = await Promise.all([
      Promise.all(forms.map((f) => db.vocabulary.where('forms').equals(f).toArray())).then((groups) =>
        groups.flat(),
      ),
      lists.length
        ? Promise.all(forms.map((f) => db.wordlistWords.where('term').equals(f).toArray())).then((groups) =>
            groups.flat(),
          )
        : [],
    ]);
    const active = new Map(lists.map((l) => [l.id, l.mode]));
    const included = new Set<string>(),
      excluded = new Set<string>();
    for (const word of matches) {
      if (active.get(word.listId) === 'include') included.add(word.term);
      if (active.get(word.listId) === 'exclude') excluded.add(word.term);
    }
    const states = new Map<string, 'known' | 'learning'>();
    for (const word of vocabulary)
      for (const form of word.forms) if (states.get(form) !== 'known') states.set(form, word.state);
    const restricted = lists.some((l) => l.mode === 'include');
    return forms.map((form) => {
      const state = states.get(form);
      return {
        form,
        state,
        suppressed:
          state === 'known' || (!state && (excluded.has(form) || (restricted && !included.has(form)))),
      };
    });
  });
}
