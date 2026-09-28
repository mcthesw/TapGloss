import type { Settings } from '../domain/model';

export function applyTheme(target: HTMLElement, preference: Settings['theme'], page?: Element) {
  let dark = matchMedia('(prefers-color-scheme: dark)').matches;
  if (preference === 'auto' && page) {
    // Transparent page backgrounds still have a rendered canvas; use text contrast as the fallback.
    const text = getComputedStyle(page)
      .color.match(/[\d.]+/g)
      ?.map(Number);
    if (text && text.length >= 3) dark = 0.2126 * text[0]! + 0.7152 * text[1]! + 0.0722 * text[2]! > 128;
    // Prefer the actual reading surface, including sites with their own theme switch.
    for (let element: Element | null = page; element; element = element.parentElement) {
      const color = getComputedStyle(element)
        .backgroundColor.match(/[\d.]+/g)
        ?.map(Number);
      if (!color || color.length < 3 || (color[3] ?? 1) < 0.8) continue;
      dark = 0.2126 * color[0]! + 0.7152 * color[1]! + 0.0722 * color[2]! < 128;
      break;
    }
  }
  target.dataset.theme = preference === 'auto' ? (dark ? 'dark' : 'light') : preference;
}
