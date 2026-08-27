import type {
  Layout,
  Locator,
  PageBox,
  ProgressionDirection,
  SpreadIntent,
  SpreadSlot,
  Viewport,
} from '../types';
import type { ViewportPaginator } from './Paginator';

export interface Paragraph {
  readonly id: string;
  readonly text: string;
}

export interface ReflowableOptions {
  readonly paragraphs: readonly Paragraph[];
  readonly progressionDirection?: ProgressionDirection;
  readonly spreadIntent?: SpreadIntent;
  readonly lineHeight?: number;
  readonly avgCharsPerEm?: number;
  readonly marginRatio?: number;
}

interface PageRange {
  readonly start: number;
  readonly end: number;
}

/**
 * A deliberately simple but deterministic reflowable paginator.
 *
 * It treats characters as uniformly sized tiles so that progression
 * (character offset / total characters) is stable across font-size and
 * viewport changes, which is exactly what the round-trip test verifies.
 */
export class ReflowablePaginator implements ViewportPaginator {
  readonly progressionDirection: ProgressionDirection;
  readonly spreadIntent: SpreadIntent;
  readonly layout: Layout = 'reflowable';

  private readonly _totalChars: number;
  private readonly _lineHeight: number;
  private readonly _avgCharsPerEm: number;
  private readonly _marginRatio: number;

  private _pageRanges: PageRange[] = [];

  constructor(options: ReflowableOptions) {
    this._totalChars = options.paragraphs.reduce(
      (sum, p) => sum + p.text.length,
      0,
    );
    this.progressionDirection = options.progressionDirection ?? 'ltr';
    this.spreadIntent = options.spreadIntent ?? 'auto';
    this._lineHeight = options.lineHeight ?? 1.5;
    this._avgCharsPerEm = options.avgCharsPerEm ?? 0.55;
    this._marginRatio = options.marginRatio ?? 0.08;

    this.repaginate({ width: 375, height: 812 }, 16);
  }

  repaginate(viewport: Viewport, fontSize: number): void {
    const contentWidth = viewport.width * (1 - this._marginRatio * 2);
    const contentHeight = viewport.height * (1 - this._marginRatio * 2);
    const lineHeightPx = fontSize * this._lineHeight;
    const linesPerPage = Math.max(1, Math.floor(contentHeight / lineHeightPx));
    const charsPerLine = Math.max(
      1,
      Math.floor(contentWidth / (fontSize * this._avgCharsPerEm)),
    );
    const charsPerPage = linesPerPage * charsPerLine;

    const ranges: PageRange[] = [];
    let offset = 0;
    while (offset < this._totalChars) {
      const end = Math.min(offset + charsPerPage, this._totalChars);
      ranges.push({ start: offset, end });
      offset = end;
    }

    if (ranges.length === 0 && this._totalChars === 0) {
      ranges.push({ start: 0, end: 0 });
    }

    this._pageRanges = ranges;
  }

  pageCount(): number {
    return this._pageRanges.length;
  }

  layoutOf(): Layout {
    return 'reflowable';
  }

  spreadSlotOf(): SpreadSlot {
    return 'auto';
  }

  pageBox(): PageBox {
    return { width: 0, height: 0 };
  }

  locatorForPage(index: number): Locator {
    const range = this._pageRanges[index];
    if (!range) {
      return { href: 'reflowable:0', locations: { progression: 0 } };
    }
    return {
      href: `reflowable:${range.start}`,
      locations: {
        progression:
          this._totalChars > 0 ? range.start / this._totalChars : 0,
      },
    };
  }

  pageForLocator(loc: Locator): number {
    const prog = loc.locations?.progression;
    if (prog === undefined || this._pageRanges.length === 0) {
      return 0;
    }
    const offset = prog * this._totalChars;
    const idx = this._pageRanges.findIndex(
      (r) => offset >= r.start && offset < r.end,
    );
    return idx < 0 ? this._pageRanges.length - 1 : idx;
  }
}
