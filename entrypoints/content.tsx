import { createWordFocus } from '../src/page/word-focus';
import { browser } from 'wxt/browser';
import { render, type VNode } from 'preact';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { send, subscribeChanges } from '../src/messages';
import { rangeAtPoint, sourceFromRange } from '../src/page/selection';
import { createHighlighter } from '../src/page/highlight';
import { applyTheme, isDarkSurface } from '../src/ui/theme';
import { Lookup } from '../src/ui/Lookup';
import { LocaleContext, resolveLocale } from '../src/ui/i18n';
import '../src/ui/style.css';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const initial = await send({ type: 'readingSettings' }).catch(() => undefined);
    if (!initial || ctx.isInvalid) return;
    let config = initial;
    const probe = (message: unknown) =>
      message && typeof message === 'object' && 'type' in message && message.type === 'readingProbe'
        ? Promise.resolve(true)
        : undefined;
    browser.runtime.onMessage.addListener(probe);
    ctx.onInvalidated(() => {
      try {
        browser.runtime.onMessage.removeListener(probe);
      } catch {
        /* Already invalidated. */
      }
    });
    let feedback: HTMLElement;
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
        feedback = document.createElement('div');
        element.append(container, feedback);
      },
      onRemove: () => {
        render(null, container);
      },
    }).catch((error: unknown) => {
      if (ctx.isInvalid) return;
      throw error;
    });
    if (!ui || ctx.isInvalid) return;
    ui.mount();
    const focus = createWordFocus(feedback!, (range) =>
      isDarkSurface(range.startContainer.parentElement ?? undefined),
    );
    let readingSurface: Element = document.body;
    let lookupView: VNode | undefined;
    const renderLookup = () =>
      render(
        <LocaleContext.Provider value={resolveLocale(config.interfaceLanguage)}>
          {lookupView}
        </LocaleContext.Provider>,
        container,
      );
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
    let highlighter: ReturnType<typeof createHighlighter> | undefined;
    const updateReading = () => {
      if (config.enabled) {
        highlighter ??= createHighlighter(
          (forms) => send({ type: 'readingWords', data: forms }),
          config.excludedLanguages,
        );
      } else {
        highlighter?.dispose();
        highlighter = undefined;
        close();
      }
    };
    let lastExclusions = JSON.stringify(config.excludedLanguages);
    const refreshSettings = async () => {
      config = await send({ type: 'readingSettings' });
      updateReading();
      if (opened) renderLookup();
      updateTheme();
      const next = JSON.stringify(config.excludedLanguages);
      if (next !== lastExclusions) {
        lastExclusions = next;
        highlighter?.refresh(config.excludedLanguages);
      }
    };
    const unsubscribe = subscribeChanges(
      (change) => {
        if (change.settings || change.initial) void refreshSettings().catch(() => {});
        if (change.vocabulary || change.initial) highlighter?.refresh();
      },
      () => ctx.notifyInvalidated(),
    );
    const close = () => {
      clickSequence++;
      focus.clear();
      render(null, container);
      lookupView = undefined;
      opened = false;
    };
    updateReading();
    const query = (range: Range, x: number, y: number) => {
      if (!config.enabled) return;
      clickSequence++;
      const source = sourceFromRange(range);
      if (!source) return;
      if (!config.configured) {
        void send({ type: 'open' }).catch(() => {});
        return;
      }
      readingSurface = range.startContainer.parentElement ?? document.body;
      updateTheme();
      opened = true;
      focus.select(range);
      lookupView = (
        <Lookup
          key={`${source.location}:${source.start}:${Date.now()}`}
          source={source}
          x={x}
          y={y}
          close={close}
        />
      );
      renderLookup();
    };
    let hoverFrame = 0;
    ctx.addEventListener(document, 'pointermove', (e) => {
      cancelAnimationFrame(hoverFrame);
      if (
        ctx.isInvalid ||
        !config.enabled ||
        !highlighter ||
        e.buttons ||
        e.composedPath().includes(ui.shadowHost)
      ) {
        focus.hover();
        return;
      }
      hoverFrame = requestAnimationFrame(() => {
        const range = rangeAtPoint(e.clientX, e.clientY);
        focus.hover(range && highlighter?.marked(range) && !highlighter.ignored(range) ? range : undefined);
      });
    });
    ctx.addEventListener(document, 'pointerleave', () => {
      cancelAnimationFrame(hoverFrame);
      focus.hover();
    });
    ctx.addEventListener(document, 'click', async (e) => {
      if (
        ctx.isInvalid ||
        !config.enabled ||
        !highlighter ||
        !e.isTrusted ||
        e.button !== 0 ||
        e.composedPath().includes(ui.shadowHost)
      )
        return;
      if (opened) close();
      const sequence = ++clickSequence;
      if (config.gesture === 'alt' && !e.altKey) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || !getSelection()?.isCollapsed) return;
      const range = rangeAtPoint(e.clientX, e.clientY);
      if (!range || highlighter.ignored(range)) return;
      if (
        (await highlighter.blocked(range).catch(() => true)) ||
        sequence !== clickSequence ||
        !range.startContainer.isConnected
      )
        return;
      query(range, e.clientX, e.clientY);
    });
    ctx.addEventListener(document, 'keydown', (e) => {
      if (ctx.isInvalid) return;
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
      close();
      unsubscribe();
      cancelAnimationFrame(hoverFrame);
      focus.dispose();
      highlighter?.dispose();
      themeObserver.disconnect();
      media.removeEventListener('change', updateTheme);
      style.remove();
    });
  },
});
