import type {
  Layout,
  Locator,
  PageBox,
  ProgressionDirection,
  SpreadIntent,
  SpreadSlot,
} from '../types';
import type { Paginator } from './Paginator';

export interface FixedPageDescriptor {
  readonly width: number;
  readonly height: number;
  readonly slot?: SpreadSlot;
}

export class FixedPaginator implements Paginator {
  readonly progressionDirection: ProgressionDirection;
  readonly spreadIntent: SpreadIntent;
  readonly layout: Layout = 'fixed';

  private readonly _pages: readonly FixedPageDescriptor[];

  constructor(
    pages: readonly FixedPageDescriptor[],
    options: {
      progressionDirection?: ProgressionDirection;
      spreadIntent?: SpreadIntent;
    } = {},
  ) {
    this._pages = pages;
    this.progressionDirection = options.progressionDirection ?? 'ltr';
    this.spreadIntent = options.spreadIntent ?? 'both';
  }

  pageCount(): number {
    return this._pages.length;
  }

  layoutOf(): Layout {
    return 'fixed';
  }

  spreadSlotOf(index: number): SpreadSlot {
    return this._pages[index]?.slot ?? 'auto';
  }

  pageBox(index: number): PageBox {
    const p = this._pages[index];
    if (!p) {
      return { width: 0, height: 0 };
    }
    return { width: p.width, height: p.height };
  }

  locatorForPage(index: number): Locator {
    const clamped = Math.max(0, Math.min(index, this._pages.length - 1));
    return {
      href: `page:${clamped}`,
      locations: {
        progression: this._pages.length > 0 ? clamped / this._pages.length : 0,
      },
    };
  }

  pageForLocator(loc: Locator): number {
    const prog = loc.locations?.progression;
    if (prog === undefined || this._pages.length === 0) {
      return 0;
    }
    const raw = Math.floor(prog * this._pages.length);
    return Math.max(0, Math.min(raw, this._pages.length - 1));
  }
}
