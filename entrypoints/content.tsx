import { render } from 'preact';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { send, subscribeChanges } from '../src/messages';
import { rangeAtPoint, sourceFromRange } from '../src/page/selection';
import { createHighlighter } from '../src/page/highlight';
import { applyTheme } from '../src/ui/theme';
import { Lookup } from '../src/ui/Lookup';
import '../src/ui/style.css';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    let config = await send({ type: 'readingSettings' });
    let container: HTMLElement,
      opened = false,
      clickSequence = 0;
    const ui = await createShadowRootUi(ctx, {
      name: 'tap-gloss',
      position: 'inline',
      anchor: 'body',
      isolateEvents: true,
      onMount: (element) => {
        container = document.createElement('div');
        element.append(container);
      },
      onRemove: () => {
        render(null, container);
      },
    });
    ui.mount();
    let readingSurface: Element = document.body;
    const updateTheme = () => applyTheme(ui.shadowHost, config.theme, readingSurface);
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', updateTheme);
    const themeObserver = new MutationObserver(updateTheme);
    for (const element of [document.documentElement, document.body])
      themeObserver.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'],
      });
    updateTheme();
    const style = document.createElement('style');
    style.textContent =
      '::highlight(tapgloss-new){background-color:#88888820}::highlight(tapgloss-learning){background-color:#dcc46860}';
    document.head.append(style);
    const highlighter = createHighlighter(
      (forms) => send({ type: 'vocabulary', data: forms }),
      config.excludedLanguages,
    );
    let lastExclusions = JSON.stringify(config.excludedLanguages);
    const refreshSettings = async () => {
      config = await send({ type: 'readingSettings' });
      updateTheme();
      const next = JSON.stringify(config.excludedLanguages);
      if (next !== lastExclusions) {
        lastExclusions = next;
        highlighter.refresh(config.excludedLanguages);
      }
    };
    const unsubscribe = subscribeChanges((change) => {
      if (change.settings || change.initial) void refreshSettings().catch(() => {});
      if (change.vocabulary || change.initial) highlighter.refresh();
    });
    const close = () => {
      clickSequence++;
      render(null, container);
      opened = false;
    };
    const query = (range: Range, x: number, y: number) => {
      clickSequence++;
      const source = sourceFromRange(range);
      if (!source) return;
      if (!config.configured) {
        void send({ type: 'open' });
        return;
      }
      readingSurface = range.startContainer.parentElement ?? document.body;
      updateTheme();
      opened = true;
      render(
        <Lookup
          key={`${source.location}:${source.start}:${Date.now()}`}
          source={source}
          x={x}
          y={y}
          close={close}
        />,
        container,
      );
    };
    ctx.addEventListener(document, 'click', async (e) => {
      if (!e.isTrusted || e.button !== 0 || e.composedPath().includes(ui.shadowHost)) return;
      if (opened) close();
      const sequence = ++clickSequence;
      if (config.gesture === 'alt' && !e.altKey) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || !getSelection()?.isCollapsed) return;
      const range = rangeAtPoint(e.clientX, e.clientY);
      if (!range || highlighter.ignored(range)) return;
      if ((await highlighter.known(range)) || sequence !== clickSequence || !range.startContainer.isConnected)
        return;
      query(range, e.clientX, e.clientY);
    });
    ctx.addEventListener(document, 'keydown', (e) => {
      if (e.key === 'Escape') close();
      if (!e.isTrusted || !e.altKey || e.code !== 'KeyQ') return;
      const selection = getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0),
        rect = range.getBoundingClientRect();
      e.preventDefault();
      query(range, rect.left, rect.bottom);
    });
    ctx.onInvalidated(() => {
      unsubscribe();
      highlighter.dispose();
      themeObserver.disconnect();
      media.removeEventListener('change', updateTheme);
      style.remove();
    });
  },
});
