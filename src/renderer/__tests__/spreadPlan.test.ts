import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSpreadGroups,
  planSpreadAt,
  type SpreadGroup,
} from '../spreadPlan';

/** `wide` lists the double-width pages, which are always shown alone. */
function groupsFor(pageCount: number, wide: number[] = [], allowSpread = true) {
  return buildSpreadGroups(pageCount, (i) => !wide.includes(i), allowSpread);
}

describe('pages the document says stand alone', () => {
  it('opens on the cover alone, then pairs the rest like a book', () => {
    // A cover marked centre, everything after it an ordinary page.
    const groups = buildSpreadGroups(7, () => true, true, (i) => i === 0);
    assert.deepEqual(groups, [
      { start: 0, size: 1 },
      { start: 1, size: 2 },
      { start: 3, size: 2 },
      { start: 5, size: 2 },
    ]);
  });

  it('never pairs a standalone page with the one before it', () => {
    // Page 3 is a drawing across both leaves: it is its own group, and the
    // pages after it resume pairing on the other parity.
    const groups = buildSpreadGroups(6, () => true, true, (i) => i === 3);
    assert.deepEqual(groups, [
      { start: 0, size: 2 },
      { start: 2, size: 1 },
      { start: 3, size: 1 },
      { start: 4, size: 2 },
    ]);
  });

  it('pairs as before when the document says nothing', () => {
    assert.deepEqual(
      buildSpreadGroups(4, () => true, true),
      buildSpreadGroups(4, () => true, true, () => false),
    );
  });
});

/** Walk from the first group to the last, collecting what is shown. */
function walkForward(groups: readonly SpreadGroup[]): number[][] {
  const seen: number[][] = [];
  let plan = planSpreadAt(groups, 0);
  // Bounded so a pairing bug shows up as a failed assertion rather than a
  // test run that never returns.
  for (let guard = 0; guard <= groups.length; guard += 1) {
    seen.push([...plan.pages]);
    if (plan.next === null) return seen;
    plan = planSpreadAt(groups, plan.next.start);
  }
  assert.fail('forward walk did not reach the end of the book');
}

function walkBackward(groups: readonly SpreadGroup[]): number[][] {
  const seen: number[][] = [];
  const last = groups[groups.length - 1];
  let plan = planSpreadAt(groups, last.start);
  for (let guard = 0; guard <= groups.length; guard += 1) {
    seen.push([...plan.pages]);
    if (plan.previous === null) return seen;
    plan = planSpreadAt(groups, plan.previous.start);
  }
  assert.fail('backward walk did not reach the start of the book');
}

/**
 * The property that matters to a reader: no page is skipped going out, none is
 * skipped coming back, and the way back is the way out reversed.
 */
function assertWalksTheWholeBook(pageCount: number, wide: number[] = []) {
  const label = `${pageCount} pages, wide [${wide.join(',')}]`;
  const groups = groupsFor(pageCount, wide);

  const forward = walkForward(groups);
  const backward = walkBackward(groups);

  const flat = forward.flat();
  assert.deepEqual(
    flat,
    Array.from({ length: pageCount }, (_, i) => i),
    `${label}: forward must show every page once, in order`,
  );
  assert.deepEqual(
    backward,
    [...forward].reverse(),
    `${label}: back-turns must retrace the same spreads`,
  );
  for (const page of wide) {
    const spread = forward.find((pages) => pages.includes(page));
    assert.deepEqual(spread, [page], `${label}: page ${page} must be alone`);
  }
}

describe('walking a book both ways', () => {
  it('covers every page of an even book', () => {
    assertWalksTheWholeBook(22);
  });

  it('covers every page of an odd book', () => {
    assertWalksTheWholeBook(23);
  });

  it('covers every page around a wide page in the middle', () => {
    // The parity flip after the solo page is what a naive "pageIndex - step"
    // back-turn gets wrong: it lands between two groups.
    assertWalksTheWholeBook(22, [9]);
  });

  it('covers every page with a wide cover', () => {
    assertWalksTheWholeBook(22, [0]);
  });

  it('covers every page with a wide last page', () => {
    assertWalksTheWholeBook(22, [21]);
  });

  it('covers every page with wide pages back to back', () => {
    assertWalksTheWholeBook(22, [4, 5, 13]);
  });

  it('covers a book that is entirely wide pages', () => {
    assertWalksTheWholeBook(7, [0, 1, 2, 3, 4, 5, 6]);
  });

  it('covers a single-page book', () => {
    assertWalksTheWholeBook(1);
  });

  it('covers every page with spreads turned off', () => {
    const groups = groupsFor(9, [], false);
    assert.deepEqual(walkForward(groups).flat(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(
      walkForward(groups).every((pages) => pages.length === 1),
      true,
      'one page at a time when spreads are off',
    );
  });
});

describe('landing on an arbitrary page', () => {
  it('resolves a page inside a pair to that pair', () => {
    const groups = groupsFor(22);
    // A bookmark or search hit on page 3 must open the spread 2|3, not start
    // a new pairing at 3 that shifts every spread after it.
    assert.deepEqual(planSpreadAt(groups, 3).pages, [2, 3]);
    assert.equal(planSpreadAt(groups, 3).leafIndex, 3);
  });

  it('clamps past the end of the book', () => {
    const groups = groupsFor(22);
    assert.deepEqual(planSpreadAt(groups, 99).pages, [20, 21]);
    assert.equal(planSpreadAt(groups, 99).next, null);
  });

  it('has no previous group on the first spread', () => {
    assert.equal(planSpreadAt(groupsFor(22), 0).previous, null);
  });

  it('has no next group on the last spread', () => {
    assert.equal(planSpreadAt(groupsFor(22), 20).next, null);
  });
});
