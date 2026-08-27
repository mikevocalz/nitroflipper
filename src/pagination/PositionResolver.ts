import type { Locator, PageBox, Viewport } from '../types';
import type { Paginator, ViewportPaginator } from './Paginator';
import { buildSpreads, spreadIndexForPage } from './PagePairing';
import { shouldUseSpread } from './SpreadPolicy';

export type ReadingMode = 'single' | 'spread';

export interface ReadingPosition {
  readonly mode: ReadingMode;
  /** The canonical reading anchor as a Readium-style Locator. */
  readonly locator: Locator;
  /** Currently visible page index when in single-page mode. */
  readonly pageIndex: number;
  /** Index into the spread array when in spread mode. */
  readonly spreadIndex: number;
  /** The page that contains the reading anchor inside the current spread. */
  readonly anchorPageIndex: number;
}

function ensureViewportPaginator(
  paginator: Paginator,
  viewport: Viewport,
  fontSize: number,
): void {
  if ('repaginate' in paginator) {
    (paginator as ViewportPaginator).repaginate(viewport, fontSize);
  }
}

function chooseRepresentativePageBox(
  paginator: Paginator,
  anchorPageIndex: number,
): PageBox {
  const box = paginator.pageBox(anchorPageIndex);
  if (box.width > 0 && box.height > 0) {
    return box;
  }
  // Fall back to a sensible default when the source has no per-page geometry.
  return { width: 1, height: 1.4 };
}

export function resolvePosition(
  paginator: Paginator,
  viewport: Viewport,
  fontSize: number,
  mode: ReadingMode,
  locator: Locator,
): ReadingPosition {
  ensureViewportPaginator(paginator, viewport, fontSize);

  const anchorPage = paginator.pageForLocator(locator);

  if (mode === 'single') {
    return {
      mode: 'single',
      locator,
      pageIndex: anchorPage,
      spreadIndex: 0,
      anchorPageIndex: anchorPage,
    };
  }

  const spreads = buildSpreads(paginator);
  const spreadIdx = spreadIndexForPage(anchorPage, spreads);
  const spread = spreads[spreadIdx] ?? spreads[0] ?? {
    left: 0,
    right: null,
    isCenter: false,
    anchor: 0,
  };

  let anchor = anchorPage;
  if (anchor !== (spread.left ?? -1) && anchor !== (spread.right ?? -1)) {
    anchor =
      paginator.progressionDirection === 'rtl'
        ? (spread.right ?? spread.left ?? anchor)
        : (spread.left ?? spread.right ?? anchor);
  }

  return {
    mode: 'spread',
    locator,
    pageIndex: anchor,
    spreadIndex: spreadIdx,
    anchorPageIndex: anchor,
  };
}

export function locatorForPosition(
  _paginator: Paginator,
  _viewport: Viewport,
  _fontSize: number,
  position: ReadingPosition,
): Locator {
  return position.locator;
}

export function chooseMode(
  paginator: Paginator,
  viewport: Viewport,
  fontSize: number,
  locator: Locator,
): ReadingMode {
  ensureViewportPaginator(paginator, viewport, fontSize);

  if (paginator.spreadIntent === 'none') {
    return 'single';
  }

  const anchorPage = paginator.pageForLocator(locator);
  const box = chooseRepresentativePageBox(paginator, anchorPage);
  return shouldUseSpread(viewport, box, paginator.spreadIntent)
    ? 'spread'
    : 'single';
}
