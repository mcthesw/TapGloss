// Keep site-specific reveal controls at the DOM boundary, outside vocabulary rules.
const selector = 'shreddit-spoiler,.md-spoiler-text';
export function spoilerOf(node: Node): Element | null {
  return (node instanceof Element ? node : node.parentElement)?.closest(selector) ?? null;
}
export function concealed(node: Node): boolean {
  let spoiler = spoilerOf(node);
  while (spoiler) {
    if (spoiler.matches('.md-spoiler-text') && !spoiler.classList.contains('revealed')) return true;
    if (spoiler.localName === 'shreddit-spoiler') {
      // Reddit keeps this state inside its shadow tree, not on the host attribute.
      const inner = spoiler.shadowRoot?.querySelector('[aria-hidden]');
      if (!inner || inner.getAttribute('aria-hidden') !== 'false') return true;
    }
    spoiler = spoiler.parentElement?.closest(selector) ?? null;
  }
  return false;
}

export function createRevealGuard(refresh: (node: Node) => void) {
  let pressed: Element | undefined;
  const blocked = new WeakSet<Event>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const target = (event: Event) =>
    event.composedPath().find((part): part is Element => part instanceof Element && !!spoilerOf(part));
  return {
    pointerdown(event: PointerEvent) {
      const element = target(event);
      pressed = element && concealed(element) ? (spoilerOf(element) ?? element) : undefined;
    },
    click(event: MouseEvent) {
      const element = target(event);
      if (element && (concealed(element) || (event.detail > 0 && pressed?.contains(element))))
        blocked.add(event);
      pressed = undefined;
      const spoiler = element && spoilerOf(element);
      if (spoiler) {
        // Let the site's handler and shadow render finish; refresh only this content block.
        const timer = setTimeout(() => {
          timers.delete(timer);
          refresh(spoiler);
        }, 0);
        timers.add(timer);
      }
    },
    blocked: (event: Event) => blocked.has(event),
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
