import { cardStyle } from '../src/anki/template';
import { settingsSchema, type Material, type Source } from '../src/domain/model';
export const settings = settingsSchema.parse({ baseUrl: 'http://127.0.0.1:9876', apiKey: 'test-only' });
export const source: Source = {
  url: 'https://example.org/reading',
  title: 'Reading',
  sentence: 'She was reluctant to ask for help.',
  start: 8,
  end: 17,
  location: 'p:0:0',
};
export const material: Material = {
  language: 'en',
  lemma: 'reluctant',
  sense: 'unwilling',
  gloss: 'not willing or eager',
  sourceTarget: 'reluctant',
  sourceOccurrence: 0,
  examples: [
    { text: 'She was reluctant to leave.', target: 'reluctant' },
    { text: 'He seemed reluctant to answer.', target: 'reluctant' },
    { text: 'They were reluctant to wait.', target: 'reluctant' },
  ],
};
export function fakeServices() {
  const notes = new Map<number, { fields: Record<string, string>; tags: string[]; modelName: string }>();
  let generations = 0,
    adds = 0,
    nextId = 1,
    loseAddResponse = false;
  let ankiOnline = true;
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body));
    if (String(input).includes('chat/completions')) {
      if (body.messages[0].content.startsWith('Match')) {
        const query = JSON.parse(body.messages[1].content);
        return Response.json({
          choices: [{ message: { content: JSON.stringify({ id: query.candidates[0]?.id ?? null }) } }],
        });
      }
      generations++;
      return Response.json({ choices: [{ message: { content: JSON.stringify(material) } }] });
    }
    if (!ankiOnline) throw new Error('offline');
    const p = body.params;
    let result: unknown = null;
    switch (body.action) {
      case 'version':
        result = 6;
        break;
      case 'deckNames':
        result = ['TapGloss'];
        break;
      case 'modelStyling':
        result = { css: cardStyle };
        break;
      case 'modelNames':
        result = ['TapGloss'];
        break;
      case 'modelFieldNames':
        result = ['TapGlossId', 'Text', 'Extra'];
        break;
      case 'findNotes':
        result = [...notes].filter(([, n]) => p.query.includes(n.fields.TapGlossId)).map(([id]) => id);
        break;
      case 'notesInfo':
        result = p.notes.map((id: number) => ({
          noteId: id,
          ...notes.get(id),
          fields: Object.fromEntries(
            Object.entries(notes.get(id)!.fields).map(([k, v]) => [k, { value: v }]),
          ),
        }));
        break;
      case 'addNote': {
        adds++;
        const id = nextId++;
        notes.set(id, structuredClone(p.note));
        if (loseAddResponse) {
          loseAddResponse = false;
          throw new Error('timeout after commit');
        }
        result = id;
        break;
      }
      case 'updateNoteFields':
        notes.get(p.note.id)!.fields = p.note.fields;
        break;
      case 'deleteNotes':
        for (const id of p.notes) notes.delete(id);
        break;
    }
    return Response.json({ result, error: null });
  };
  return {
    fetcher,
    notes,
    counts: () => ({ generations, adds }),
    loseNextAdd: () => {
      loseAddResponse = true;
    },
    offline: (value: boolean) => {
      ankiOnline = !value;
    },
  };
}
