import { afterEach, expect, it } from 'vitest';
import { Database, setVocabularyState } from '../src/storage/database';
import { importWordlist, changeWordlist, readingWords } from '../src/storage/wordlists';
import { parseWordlist } from '../src/ui/parse-wordlist';
import { SyncEngine } from '../src/sync/engine';
import type { RemoteStore } from '../src/sync/transport';

const databases: Database[] = [];
const database = () => {
  const db = new Database(crypto.randomUUID());
  databases.push(db);
  return db;
};
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});
it('parses plain text and quoted frequency tables without treating ranks as words', () => {
  expect(parseWordlist('Apple\nAPPLE\n# comment\nbook\n', 'words.txt')).toEqual({
    terms: ['apple', 'book'],
    duplicates: 1,
  });
  expect(parseWordlist('rank,word,frequency\n1,"hello, world",42\n2,book,12', 'words.csv').terms).toEqual([
    'hello, world',
    'book',
  ]);
  expect(parseWordlist('1\tapple\t500\n2\tbook\t200', 'words.tsv').terms).toEqual(['apple', 'book']);
  expect(() => parseWordlist('"unclosed quote', 'words.csv')).toThrow();
});
it('combines baselines while preserving explicit states, history and queries', async () => {
  const db = database();
  const exclude = await importWordlist(db, { name: 'Common', terms: ['apple', 'book'] });
  expect((await readingWords(db, ['APPLE', 'pear'])).map((w) => w.suppressed)).toEqual([true, false]);
  await db.vocabulary.put({
    id: 'en:apple',
    language: 'en',
    lemma: 'apple',
    forms: ['apple'],
    state: 'learning',
  });
  expect((await readingWords(db, ['apple']))[0]?.suppressed).toBe(false);
  await setVocabularyState(db, 'en:apple', 'known');
  expect((await readingWords(db, ['apple']))[0]?.suppressed).toBe(true);
  const include = await importWordlist(db, { name: 'Focus', mode: 'include', terms: ['pear', 'book'] });
  expect((await readingWords(db, ['pear', 'book', 'orange'])).map((w) => w.suppressed)).toEqual([
    false,
    true,
    true,
  ]);
  await changeWordlist(db, exclude, { enabled: false });
  expect((await readingWords(db, ['book']))[0]?.suppressed).toBe(false);
  await changeWordlist(db, include, {}, true);
  expect((await readingWords(db, ['orange']))[0]?.suppressed).toBe(false);
  expect((await db.vocabulary.get('en:apple'))?.state).toBe('known');
  expect(await db.wordlistWords.where('listId').equals(include).count()).toBe(0);
});
it('syncs wordlist contents and removal without affecting personal vocabulary', async () => {
  const a = database(),
    b = database();
  const files = new Map<string, Uint8Array>();
  let version = 0;
  const remote: RemoteStore = {
    async list() {
      return [...files.keys()].map((key) => ({ key, revision: String(version) }));
    },
    async get(key) {
      return files.get(key)!.slice();
    },
    async put(key, bytes) {
      files.set(key, bytes.slice());
      version++;
    },
  };
  const id = await importWordlist(a, { name: 'Common', terms: ['hello', 'world'] });
  await new SyncEngine(a).run(remote, 'test');
  await new SyncEngine(b).run(remote, 'test');
  expect((await readingWords(b, ['hello']))[0]?.suppressed).toBe(true);
  await changeWordlist(b, id, {}, true);
  await new SyncEngine(b).run(remote, 'test');
  await new SyncEngine(a).run(remote, 'test');
  expect((await a.wordlists.get(id))?.deleted).toBe(true);
  expect((await readingWords(a, ['hello']))[0]?.suppressed).toBe(false);
  expect(await a.wordlistWords.where('listId').equals(id).count()).toBe(0);
});
