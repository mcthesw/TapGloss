import { expect, it } from 'vitest';
import { availableModels, explain } from '../src/explain/client';
import { Anki, noteFields } from '../src/anki/client';
import { settingsSchema } from '../src/domain/model';
import { material, source } from './fixtures';

it.skipIf(!process.env.TAPGLOSS_LIVE_API_KEY)(
  'real compatible model returns usable contextual examples',
  async () => {
    const s = settingsSchema.parse({
      apiKey: process.env.TAPGLOSS_LIVE_API_KEY,
      baseUrl: process.env.TAPGLOSS_LIVE_BASE_URL || 'https://api.deepseek.com',
      model: process.env.TAPGLOSS_LIVE_MODEL || 'deepseek-flash',
    });
    const result = await explain(s, source);
    expect(result.examples).toHaveLength(3);
    expect(result.language).toBe('en');
    expect(await availableModels(s)).toContain(s.model);
  },
  90000,
);

it.skipIf(!process.env.TAPGLOSS_LIVE_ANKI)(
  'real Anki creates, reads and removes only the disposable verification note',
  async () => {
    const s = settingsSchema.parse({ deck: 'TapGloss' });
    const anki = new Anki(s),
      id = crypto.randomUUID();
    const entry = {
      id,
      language: 'en',
      lemma: 'reluctant',
      sense: 'unwilling',
      generationId: 'smoke',
      createdAt: Date.now(),
    };
    try {
      expect((await anki.testConnection()).version).toBeGreaterThanOrEqual(6);
      await anki.setup();
      const noteId = await anki.create(noteFields(entry, material, [{ id: 'smoke', source, createdAt: 0 }]));
      const found = await anki.find(entry);
      expect(found?.noteId).toBe(noteId);
      expect(found?.fields.Text?.value.match(/\{\{c1::/g)).toHaveLength(3);
      expect(found?.fields.Extra?.value).not.toContain(material.examples[0]!.text);
      expect(found?.fields.Extra?.value).toContain('<details>');
      const updated = noteFields(entry, { ...material, gloss: 'not willing' }, [
        { id: 'smoke', source, createdAt: 0 },
      ]);
      await anki.call('updateNoteFields', { note: { id: noteId, fields: updated } });
      expect((await anki.find(entry))?.noteId).toBe(noteId);
    } finally {
      const found = await anki.find(entry);
      if (found) await anki.call('deleteNotes', { notes: [found.noteId] });
    }
  },
  30000,
);
