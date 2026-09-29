import { isNumericExpression } from '../domain/expression';
import type { Source } from '../domain/model';

const excluded =
  'a,button,input,textarea,select,[contenteditable]:not([contenteditable="false"]),script,style,pre,code,nav,header,footer,[role="button"],tap-gloss';
export function eligible(node: Node) {
  return !node.parentElement?.closest(excluded);
}
export function textNodes(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (eligible(n) && n.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}
export function rangeAtPoint(x: number, y: number): Range | undefined {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = doc.caretPositionFromPoint?.(x, y);
  let range = doc.caretRangeFromPoint?.(x, y) ?? undefined;
  if (caret) {
    range = document.createRange();
    range.setStart(caret.offsetNode, caret.offset);
    range.collapse(true);
  }
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE || !eligible(range.startContainer)) return;
  const text = range.startContainer.textContent ?? '';
  const word = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].find(
    (s) => s.isWordLike && s.index <= range!.startOffset && s.index + s.segment.length > range!.startOffset,
  );
  if (!word || isNumericExpression(word.segment)) return;
  range.setStart(range.startContainer, word.index);
  range.setEnd(range.startContainer, word.index + word.segment.length);
  const rect = range.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
  return range;
}
export function sourceFromRange(range: Range): Source | undefined {
  if (isNumericExpression(range.toString())) return;
  if (!eligible(range.startContainer) || !eligible(range.endContainer) || range.toString().length > 200)
    return;
  const block =
    range.startContainer.parentElement?.closest('p,li,blockquote,h1,h2,h3,h4,td,article,section,div') ??
    document.body;
  if (!block.contains(range.endContainer)) return;
  const nodes = textNodes(block);
  let text = '',
    start = -1,
    end = -1;
  for (const node of nodes) {
    if (node === range.startContainer) start = text.length + range.startOffset;
    if (node === range.endContainer) end = text.length + range.endOffset;
    text += node.data;
  }
  if (start < 0 || end <= start) return;
  const sentences = [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)];
  const first = sentences.find((s) => s.index <= start && s.index + s.segment.length > start);
  const last = sentences.find((s) => s.index < end && s.index + s.segment.length >= end);
  if (!first || !last) return;
  const sentence = text.slice(first.index, last.index + last.segment.length);
  if (sentence.length > 6000) return;
  // A structural anchor distinguishes identical sentences without using generated text.
  const path: string[] = [];
  for (let el: Element | null = block; el && el !== document.body; el = el.parentElement) {
    path.unshift(`${el.tagName.toLowerCase()}:${Array.from(el.parentElement?.children ?? []).indexOf(el)}`);
  }
  return {
    sentence,
    start: start - first.index,
    end: end - first.index,
    url: location.href,
    title: document.title.slice(0, 500),
    location: `${path.join('/')}:${first.index}`.slice(-160),
  };
}
