import type { Paginator } from './Paginator';
import type { ProgressionDirection, SpreadSlot } from '../types';

export interface PageSpread {
  /** Page index occupying the left visual slot, or null. */
  readonly left: number | null;
  /** Page index occupying the right visual slot, or null. */
  readonly right: number | null;
  /** True when a single page occupies the whole spread. */
  readonly isCenter: boolean;
  /** The page that should be used as the anchor for this spread. */
  readonly anchor: number;
}

function opposite(slot: SpreadSlot): SpreadSlot {
  if (slot === 'left') return 'right';
  if (slot === 'right') return 'left';
  return 'auto';
}

function inferSlot(
  index: number,
  direction: ProgressionDirection,
  explicitSlot: SpreadSlot,
  previousWasCenter: boolean,
): SpreadSlot {
  if (explicitSlot !== 'auto') return explicitSlot;

  // Without explicit slot data, the cover (if any) is centered and the
  // remaining pages alternate. In LTR the first non-cover page is the left
  // (verso) side; in RTL it is the right side.
  const offset = previousWasCenter ? 1 : 0;
  const isLeft = (index - offset) % 2 === 0;
  if (direction === 'rtl') {
    return isLeft ? 'right' : 'left';
  }
  return isLeft ? 'left' : 'right';
}

/**
 * Group a paginated sequence into spreads.
 *
 * Honors explicit `spreadSlotOf` values and falls back to the common
 * cover-center + alternating recto/verso heuristic.
 */
export function buildSpreads(paginator: Paginator): readonly PageSpread[] {
  const count = paginator.pageCount();
  const spreads: PageSpread[] = [];
  let i = 0;
  let previousWasCenter = false;

  while (i < count) {
    const slot = inferSlot(
      i,
      paginator.progressionDirection,
      paginator.spreadSlotOf(i),
      previousWasCenter,
    );

    if (slot === 'center') {
      spreads.push({ left: null, right: null, isCenter: true, anchor: i });
      i += 1;
      previousWasCenter = true;
      continue;
    }

    if (i + 1 < count) {
      const nextSlot = inferSlot(
        i + 1,
        paginator.progressionDirection,
        paginator.spreadSlotOf(i + 1),
        previousWasCenter,
      );
      if (nextSlot === opposite(slot)) {
        const [left, right] =
          paginator.progressionDirection === 'rtl'
            ? [i + 1, i]
            : [i, i + 1];
        spreads.push({ left, right, isCenter: false, anchor: i });
        i += 2;
        previousWasCenter = false;
        continue;
      }
    }

    // Unpaired page: occupies its own side of the spread.
    const anchor = i;
    if (slot === 'left') {
      spreads.push({ left: anchor, right: null, isCenter: false, anchor });
    } else {
      spreads.push({ left: null, right: anchor, isCenter: false, anchor });
    }
    i += 1;
    previousWasCenter = false;
  }

  return spreads;
}

export function spreadIndexForPage(
  pageIndex: number,
  spreads: readonly PageSpread[],
): number {
  const idx = spreads.findIndex(
    (s) => s.left === pageIndex || s.right === pageIndex || s.anchor === pageIndex,
  );
  return idx < 0 ? 0 : idx;
}
