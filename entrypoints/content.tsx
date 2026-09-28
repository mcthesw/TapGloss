import { render } from 'preact';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { send } from '../src/messages';
import { normalize } from '../src/domain/model';
import { rangeAtPoint, sourceFromRange } from '../src/page/selection';
import { highlightPage } from '../src/page/highlight';
import { languageFilter } from '../src/page/languages';
import { browser } from 'wxt/browser';
import { applyTheme } from '../src/ui/theme';
import { Lookup } from '../src/ui/Lookup';
import '../src/ui/style.css';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    let config = await send({ type: 'vocabulary' });
    let container: HTMLElement,
      opened = false;
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
    let snapshot = '',
      scheduled = false;
    const refresh = async () => {
      const next = await send({ type: 'vocabulary' });
      config = next;
      updateTheme();
      const serialized = JSON.stringify([next.words, next.excludedLanguages]);
      if (serialized !== snapshot) {
        snapshot = serialized;
        highlightPage(next.words, next.excludedLanguages);
      }
    };
    const close = () => {
      render(null, container);
      opened = false;
    };
    const query = (range: Range, x: number, y: number) => {
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
          refresh={() => {
            void refresh().catch(() => {});
          }}
        />,
        container,
      );
    };
    ctx.addEventListener(document, 'click', (e) => {
      if (!e.isTrusted || e.button !== 0 || e.composedPath().includes(ui.shadowHost)) return;
      if (opened) {
        close();
        return;
      }
      if (config.gesture === 'alt' && !e.altKey) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || !getSelection()?.isCollapsed) return;
      const range = rangeAtPoint(e.clientX, e.clientY);
      if (
        !range ||
        config.words.some((w) => w.state === 'known' && w.forms.includes(normalize(range.toString())))
      )
        return;
      if (
        languageFilter(config.excludedLanguages)(
          range.startContainer as Text,
          range.toString(),
          range.startOffset,
        )
      )
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
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      ctx.setTimeout(() => {
        scheduled = false;
        highlightPage(config.words, config.excludedLanguages);
      }, 500);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['lang'],
    });
    ctx.addEventListener(window, 'focus', () => {
      void refresh().catch(() => {});
    });
    const settingsChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && changes.settings) void refresh().catch(() => {});
    };
    browser.storage.onChanged.addListener(settingsChanged);
    ctx.onInvalidated(() => {
      observer.disconnect();
      browser.storage.onChanged.removeListener(settingsChanged);
      themeObserver.disconnect();
      media.removeEventListener('change', updateTheme);
      style.remove();
    });
    await refresh();
  },
});
