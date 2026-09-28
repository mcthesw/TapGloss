import { cardStyle, legacyCardStyle } from './template';
import { z } from 'zod';
import { hash, type Capture, type Entry, type Material, type Settings } from '../domain/model';
import { fetchService, httpFailure } from '../domain/failure';

export const modelName = 'TapGloss';
const fields = ['TapGlossId', 'Text', 'Extra'];
export const escapeHtml = (s: string) => s.replace(/[&<>"'{}]/g, (c) => `&#${c.charCodeAt(0)};`);
export function noteFields(entry: Entry, material: Material, captures: Capture[]) {
  return {
    TapGlossId: entry.id,
    Text: material.examples
      .map((e) => {
        const i = e.text.indexOf(e.target);
        return `<p>${escapeHtml(e.text.slice(0, i))}{{c1::${escapeHtml(e.target)}}}${escapeHtml(e.text.slice(i + e.target.length))}</p>`;
      })
      .join(''),
    Extra:
      (material.gloss ? `<p>${escapeHtml(material.gloss)}</p>` : '') +
      (captures.length
        ? '<details><summary>原文与来源</summary>' +
          captures
            .map(
              (c) =>
                `<blockquote>${escapeHtml(c.source.sentence)}</blockquote><a href="${escapeHtml(c.source.url)}">${escapeHtml(c.source.title || new URL(c.source.url).hostname)}</a>`,
            )
            .join('') +
          '</details>'
        : ''),
  };
}
const noteSchema = z.object({
  noteId: z.number(),
  modelName: z.string(),
  tags: z.array(z.string()),
  fields: z.record(z.string(), z.object({ value: z.string() })),
});
type Note = z.infer<typeof noteSchema>;
export class Anki {
  constructor(private settings: Pick<Settings, 'ankiUrl' | 'ankiKey' | 'deck'>) {}
  async testConnection(signal?: AbortSignal) {
    const version = z.number().parse(await this.call('version', {}, signal));
    if (version < 6) throw new Error('请更新 AnkiConnect 后重试');
    // Check authenticated access without creating or changing any Anki data.
    await this.call('deckNames', {}, signal);
    return { version };
  }
  async call(action: string, params: unknown = {}, signal?: AbortSignal): Promise<unknown> {
    const response = await fetchService(
      this.settings.ankiUrl,
      {
        method: 'POST',
        signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          version: 6,
          params,
          ...(this.settings.ankiKey ? { key: this.settings.ankiKey } : {}),
        }),
      },
      '等待 Anki：请打开 Anki 并启用 AnkiConnect',
    );
    if (!response.ok) throw httpFailure('Anki', response.status);
    const body = z.object({ result: z.unknown(), error: z.string().nullable() }).parse(await response.json());
    if (body.error) throw new Error('Anki 未完成操作，请检查 AnkiConnect 权限与牌组设置');
    return body.result;
  }
  async setup() {
    const models = z.array(z.string()).parse(await this.call('modelNames'));
    if (!models.includes(modelName))
      await this.call('createModel', {
        modelName,
        inOrderFields: fields,
        isCloze: true,
        css: cardStyle,
        cardTemplates: [
          { Name: 'Context', Front: '{{cloze:Text}}', Back: '{{cloze:Text}}<hr id="answer">{{Extra}}' },
        ],
      });
    const existing = z.array(z.string()).parse(await this.call('modelFieldNames', { modelName }));
    if (JSON.stringify(existing) !== JSON.stringify(fields))
      throw new Error('已有 TapGloss 笔记类型不兼容，请在 Anki 中检查，未修改现有模板');
    const style = z.object({ css: z.string() }).parse(await this.call('modelStyling', { modelName }));
    // Only replace the exact shipped stylesheet; preserve personal template changes.
    if (style.css.trim() === legacyCardStyle.trim())
      await this.call('updateModelStyling', { model: { name: modelName, css: cardStyle } });
    await this.call('createDeck', { deck: this.settings.deck });
  }
  async find(entry: Entry): Promise<Note | undefined> {
    const ids = z
      .array(z.number())
      .parse(await this.call('findNotes', { query: `"note:${modelName}" "TapGlossId:${entry.id}"` }));
    if (ids.length > 1) throw new Error('发现多份关联笔记，请在 Anki 中检查重复项');
    if (!ids.length) return;
    const notes = z.array(noteSchema).parse(await this.call('notesInfo', { notes: ids }));
    const note = notes[0];
    if (
      !note ||
      note.modelName !== modelName ||
      !note.tags.includes('tapgloss') ||
      note.fields.TapGlossId?.value !== entry.id
    )
      throw new Error('无法确认笔记归属，未修改 Anki');
    return note;
  }
  async fieldHash(note: Note) {
    return hash(Object.fromEntries(fields.map((f) => [f, note.fields[f]?.value ?? ''])));
  }
  async create(values: ReturnType<typeof noteFields>) {
    return z.number().parse(
      await this.call('addNote', {
        note: {
          deckName: this.settings.deck,
          modelName,
          fields: values,
          tags: ['tapgloss'],
          options: { allowDuplicate: false },
        },
      }),
    );
  }
}
