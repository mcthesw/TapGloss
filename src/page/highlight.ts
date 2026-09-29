import { isReadingExpression } from '../domain/expression';
import type { ReadingWord } from '../domain/wordlists';
import { normalize } from '../domain/model';
import { eligible, textNodes } from './selection';
import { languageFilter } from './languages';

type RangeSet = Set<Range>;
// Own only visible/nearby blocks. Page mutations invalidate those blocks, not the whole page.
export function createHighlighter(
  lookup: (forms: string[]) => Promise<ReadingWord[]>,
  exclusions: readonly string[],
) {
  const css = CSS as typeof CSS & { highlights?: Map<string, RangeSet> };
  const Type = (globalThis as unknown as { Highlight?: new () => RangeSet }).Highlight;
  const fresh = Type ? new Type() : new Set<Range>(),
    learning = Type ? new Type() : new Set<Range>();
  css.highlights?.set('tapgloss-new', fresh);
  css.highlights?.set('tapgloss-learning', learning);
  const tracked = new Set<Element>(),
    visible = new Set<Element>(),
    pending = new Set<Element>();
  const ranges = new Map<Element, Range[]>(),
    words = new Map<string, ReadingWord>();
  let stopped = false,
    running = false,
    revision = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  let excluded = exclusions;
  const blockOf = (node: Node) =>
    node.parentElement?.closest('p,li,blockquote,h1,h2,h3,h4,td,article,section,div') ?? document.body;
  const remove = (block: Element) => {
    for (const range of ranges.get(block) ?? []) {
      fresh.delete(range);
      learning.delete(range);
    }
    ranges.delete(block);
  };
  const fetchWords = async (forms: string[]) => {
    const missing = [...new Set(forms)].filter((word) => !words.has(word));
    const current = revision;
    for (let i = 0; i < missing.length; i += 500) {
      const batch = missing.slice(i, i + 500),
        found = await lookup(batch);
      if (current !== revision || stopped) return;
      if (words.size > 5000) words.clear();
      for (const form of batch) words.set(form, { form, suppressed: false });
      for (const word of found) words.set(word.form, word);
    }
  };
  const process = async () => {
    if (running || stopped || document.hidden) return;
    running = true;
    try {
      let work = 0;
      for (const block of pending) {
        pending.delete(block);
        if (!block.isConnected || !visible.has(block)) continue;
        const current = revision;
        const nodes = textNodes(block).filter((node) => blockOf(node) === block);
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        const segments = nodes.flatMap((node) =>
          [...segmenter.segment(node.data)]
            .filter((s) => s.isWordLike && isReadingExpression(s.segment))
            .map((s) => ({ node, ...s })),
        );
        await fetchWords(segments.map((s) => normalize(s.segment)));
        if (current !== revision || stopped || !visible.has(block) || !block.isConnected) continue;
        remove(block);
        const ignore = languageFilter(excluded),
          next: Range[] = [];
        for (const s of segments) {
          const word = words.get(normalize(s.segment));
          if (word?.suppressed || ignore(s.node, s.segment, s.index)) continue;
          if (s.index + s.segment.length > s.node.length) continue;
          const range = document.createRange();
          range.setStart(s.node, s.index);
          range.setEnd(s.node, s.index + s.segment.length);
          (word?.state === 'learning' ? learning : fresh).add(range);
          next.push(range);
        }
        ranges.set(block, next);
        if (++work >= 8) break;
      }
    } catch {
      /* A subsequent page change or reconnect retries visible blocks. */
    } finally {
      running = false;
      if (pending.size && !stopped && !document.hidden) schedule();
    }
  };
  const schedule = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void process();
    }, 30);
  };
  const visibility = new IntersectionObserver(
    (changes) => {
      for (const entry of changes) {
        if (entry.isIntersecting) {
          visible.add(entry.target);
          pending.add(entry.target);
        } else {
          visible.delete(entry.target);
          pending.delete(entry.target);
          remove(entry.target);
        }
      }
      schedule();
    },
    { rootMargin: '400px' },
  );
  const discover = (root: Node) => {
    if (!eligible(root) || (root instanceof Element && root.closest('tap-gloss'))) return;
    const nodes = root.nodeType === Node.TEXT_NODE ? [root as Text] : textNodes(root);
    for (const node of nodes) {
      if (!eligible(node) || !node.data.trim()) continue;
      const block = blockOf(node);
      if (!tracked.has(block)) {
        tracked.add(block);
        visibility.observe(block);
      }
      if (visible.has(block)) pending.add(block);
    }
    schedule();
  };
  const mutations = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'attributes') {
        for (const block of visible) if ((change.target as Element).contains(block)) pending.add(block);
      } else {
        if (change.type === 'characterData') discover(change.target);
        else {
          const element = change.target as Element;
          const parent =
            element.closest('p,li,blockquote,h1,h2,h3,h4,td,article,section,div') ?? document.body;
          if (visible.has(parent)) pending.add(parent);
        }
        for (const node of change.addedNodes) discover(node);
      }
    }
    for (const block of tracked)
      if (!block.isConnected) {
        visibility.unobserve(block);
        tracked.delete(block);
        visible.delete(block);
        pending.delete(block);
        remove(block);
      }
    schedule();
  });
  discover(document.body);
  mutations.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['lang'],
  });
  const refresh = (next: readonly string[] = excluded) => {
    excluded = next;
    revision++;
    words.clear();
    for (const block of visible) pending.add(block);
    schedule();
  };
  const shown = () => {
    if (!document.hidden) refresh();
  };
  document.addEventListener('visibilitychange', shown);
  return {
    refresh,
    recheck(node: Node) {
      if (stopped || !node.isConnected) return;
      const block = blockOf(node);
      remove(block);
      discover(block);
    },
    marked(range: Range) {
      const word = words.get(normalize(range.toString()));
      return !!word && !word.suppressed;
    },
    async blocked(range: Range) {
      const form = normalize(range.toString());
      await fetchWords([form]);
      return words.get(form)?.suppressed ?? false;
    },
    ignored(range: Range) {
      return languageFilter(excluded)(range.startContainer as Text, range.toString(), range.startOffset);
    },
    dispose() {
      stopped = true;
      revision++;
      clearTimeout(timer);
      mutations.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', shown);
      fresh.clear();
      learning.clear();
      css.highlights?.delete('tapgloss-new');
      css.highlights?.delete('tapgloss-learning');
    },
  };
}
