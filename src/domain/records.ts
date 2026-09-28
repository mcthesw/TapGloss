import type { Capture, Job, Material, RecordView, Vocabulary } from './model';

export type CatalogRow = {
  id: string;
  entryId?: string;
  captureId: string;
  term: string;
  gloss: string;
  language?: string;
  createdAt: number;
  tokens: string[];
};
export type RecordSummary = Omit<CatalogRow, 'tokens'> & {
  state?: Vocabulary['state'];
  job?: Job;
  exported: boolean;
  examples?: Material['examples'];
};
export type RecordPage = { records: RecordSummary[]; next?: number; before?: [number, string] };
export type RecordDetail = { record: RecordView; sources: Capture[]; moreSources: boolean };
export const pageSize = 100;
export function searchTokens(text: string): string[] {
  return [
    ...new Set(
      [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text.normalize('NFC').toLowerCase())]
        .filter((part) => part.isWordLike)
        .map((part) => part.segment),
    ),
  ];
}
