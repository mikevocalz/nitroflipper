import type {
  Layout,
  Locator,
  PageBox,
  ProgressionDirection,
  SpreadIntent,
  SpreadSlot,
  Viewport,
} from '../types';

/**
 * A Paginator abstracts the question "which page(s) are visible and where is the
 * reading anchor?" for both fixed-layout and reflowable sources.
 *
 * It is intentionally separate from `PageSource` so that reflowable
 * repagination can depend on viewport and font size without leaking those
 * concerns into the archive/PDF source seam.
 */
export interface Paginator {
  readonly progressionDirection: ProgressionDirection;
  readonly spreadIntent: SpreadIntent;
  pageCount(): number;
  layoutOf(index: number): Layout;
  spreadSlotOf(index: number): SpreadSlot;
  pageBox(index: number): PageBox;
  locatorForPage(index: number): Locator;
  pageForLocator(loc: Locator): number;
}

/**
 * A paginator that can be re-paginated per viewport/font-size.
 */
export interface ViewportPaginator extends Paginator {
  repaginate(viewport: Viewport, fontSize: number): void;
}

export function isViewportPaginator(p: Paginator): p is ViewportPaginator {
  return 'repaginate' in p && typeof (p as ViewportPaginator).repaginate === 'function';
}
