export type Layout = 'fixed' | 'reflowable';

export type SpreadIntent = 'none' | 'landscape' | 'portrait' | 'both' | 'auto';

export type SpreadSlot = 'left' | 'right' | 'center' | 'auto';

export type ProgressionDirection = 'ltr' | 'rtl';

export interface PageBox {
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * Readium-style Locator.
 * For fixed-layout content `locations.progression` is `index / pageCount`.
 * For reflowable content it is `charOffset / totalChars`.
 */
export interface Locator {
  readonly href: string;
  readonly title?: string;
  readonly locations?: {
    readonly progression?: number;
    readonly position?: number;
    readonly totalProgression?: number;
  };
}

/**
 * PageSource is the seam the renderer uses; Phase 2 implements the parts that
 * do not need a GPU.
 */
export interface PageSource {
  readonly pageCount: number;
  readonly spreadIntent: SpreadIntent;
  readonly progressionDirection: ProgressionDirection;
  layoutOf(index: number): Layout;
  spreadSlotOf(index: number): SpreadSlot;
  getPageBox(index: number): PageBox;
  locatorForPage(index: number): Locator;
  pageForLocator(loc: Locator): number;
  readEntryBytes(index: number): Promise<ArrayBuffer>;
  /** Page re-encoded to fit the given box, so pages are not held at source size. */
  readPageScaled(
    index: number,
    maxWidth: number,
    maxHeight: number,
  ): Promise<ArrayBuffer>;
}
