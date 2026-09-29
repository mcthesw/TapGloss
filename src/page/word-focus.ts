// Paint only hovered/selected ranges; never wrap or change the page's text nodes.
export function createWordFocus(host: HTMLElement) {
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
  host.append(layer);
  let hovered: Range | undefined,
    selected: Range | undefined,
    text = '',
    frame = 0;
  const draw = () => {
    frame = 0;
    layer.replaceChildren();
    if (selected && (!selected.startContainer.isConnected || selected.toString() !== text))
      selected = undefined;
    for (const [range, active] of [
      [hovered, false],
      [selected, true],
    ] as const) {
      if (!range?.startContainer.isConnected) continue;
      for (const rect of Array.from(range.getClientRects()).slice(0, 20)) {
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
        const mark = document.createElement('div');
        mark.dataset.wordFocus = active ? 'selected' : 'hover';
        mark.style.cssText = `position:fixed;left:${rect.left - 2}px;top:${rect.top - 1}px;width:${rect.width + 4}px;height:${rect.height + 2}px;border-radius:3px;box-sizing:border-box;background:${active ? '#b9a66830' : '#88888820'};box-shadow:inset 0 0 0 1px ${active ? '#b9a668a0' : '#88888850'};pointer-events:none`;
        layer.append(mark);
      }
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const scroll = () => {
    hovered = undefined;
    schedule();
  };
  window.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', schedule);
  return {
    hover(range?: Range) {
      hovered = range;
      schedule();
    },
    select(range?: Range) {
      selected = range?.cloneRange();
      text = range?.toString() ?? '';
      hovered = undefined;
      schedule();
    },
    clear() {
      hovered = selected = undefined;
      schedule();
    },
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', schedule);
      layer.remove();
    },
  };
}
