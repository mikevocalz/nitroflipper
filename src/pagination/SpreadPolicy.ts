import type { PageBox, SpreadIntent, Viewport } from '../types';

/**
 * Width test from §4.1: a spread is viable when two page-widths fit inside
 * the container height (pages are scaled to fill the height).
 */
export function shouldUseSpread(
  viewport: Viewport,
  pageBox: PageBox,
  spreadIntent: SpreadIntent,
): boolean {
  if (spreadIntent === 'none') {
    return false;
  }

  const pageAspect = pageBox.width / pageBox.height;
  const fitsTwoPages = 2 * pageAspect * viewport.height <= viewport.width + 1e-6;

  switch (spreadIntent) {
    case 'both':
      return fitsTwoPages;
    case 'landscape':
      return fitsTwoPages && viewport.width >= viewport.height;
    case 'portrait':
      return fitsTwoPages && viewport.height > viewport.width;
    case 'auto':
    default:
      return fitsTwoPages;
  }
}
