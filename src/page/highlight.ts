import { normalize, type Vocabulary } from '../domain/model';
import { textNodes } from './selection';

export function highlightPage(words: Vocabulary[]) {
  const css = CSS as typeof CSS & { highlights?: Map<string, unknown> };
  const HighlightType = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown })
    .Highlight;
  if (!css.highlights || !HighlightType) return;
  const known = new Set(words.filter((w) => w.state === 'known').flatMap((w) => w.forms));
  const learning = new Set(words.filter((w) => w.state === 'learning').flatMap((w) => w.forms));
  const fresh: Range[] = [],
    studying: Range[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  for (const node of textNodes(document.body)) {
    if (!node.parentElement?.getClientRects().length) continue;
    for (const s of segmenter.segment(node.data)) {
      if (!s.isWordLike || known.has(normalize(s.segment)) || /^\p{N}+$/u.test(s.segment)) continue;
      const range = document.createRange();
      range.setStart(node, s.index);
      range.setEnd(node, s.index + s.segment.length);
      (learning.has(normalize(s.segment)) ? studying : fresh).push(range);
    }
  }
  css.highlights.set('tapgloss-new', new HighlightType(...fresh));
  css.highlights.set('tapgloss-learning', new HighlightType(...studying));
}
