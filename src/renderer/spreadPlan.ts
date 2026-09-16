/**
 * Which pages sit together on screen, and what a turn moves.
 *
 * Pairing has to be decided for the whole book at once, not at the position
 * you happen to be on. A double-width page is shown alone, so the pages after
 * it pair up on the opposite parity -- and a back-turn that just subtracts the
 * *current* group's size lands between two groups. From there the reader walks
 * a different set of pairs than it walked forward, and pages seen on the way
 * out are never seen on the way back.
 */
export interface SpreadGroup {
  /** First page of the group; the index the reader is positioned on. */
  readonly start: number;
  /** 1 for a page shown alone, 2 for a pair. */
  readonly size: number;
}

/**
 * Group every page in the book, left to right.
 *
 * `fitsTwoUp(index)` answers whether that page can share the viewport; a page
 * that cannot is a group of its own, and grouping resumes after it.
 */
export function buildSpreadGroups(
  pageCount: number,
  fitsTwoUp: (index: number) => boolean,
  allowSpread: boolean,
): SpreadGroup[] {
  const groups: SpreadGroup[] = [];
  for (let i = 0; i < pageCount; ) {
    const paired =
      allowSpread && fitsTwoUp(i) && i + 1 < pageCount && fitsTwoUp(i + 1);
    const size = paired ? 2 : 1;
    groups.push({ start: i, size });
    i += size;
  }
  return groups;
}

export interface SpreadPlan {
  /** Two pages side by side. */
  readonly spread: boolean;
  /** Pages this group covers -- also how far a turn moves. */
  readonly step: number;
  /** The group's pages, in reading order. */
  readonly pages: readonly number[];
  /** Page carrying the curl: the second of a pair, or the only one. */
  readonly leafIndex: number;
  /** Where a forward turn lands, or null at the end of the book. */
  readonly next: SpreadGroup | null;
  /** Where a back turn lands, or null at the start. */
  readonly previous: SpreadGroup | null;
}

/**
 * The plan for the group holding `pageIndex`.
 *
 * An index that falls inside a group -- page 3 of the pair 2|3 -- resolves to
 * that group rather than starting a new one, so an arbitrary jump (a bookmark,
 * a search hit, a restored position) lands on a real spread.
 */
export function planSpreadAt(
  groups: readonly SpreadGroup[],
  pageIndex: number,
): SpreadPlan {
  let at = groups.findIndex(
    (g) => pageIndex >= g.start && pageIndex < g.start + g.size,
  );
  if (at < 0) at = groups.length > 0 ? groups.length - 1 : 0;
  const group = groups[at] ?? { start: 0, size: 1 };
  const pages = Array.from({ length: group.size }, (_, i) => group.start + i);
  return {
    spread: group.size === 2,
    step: group.size,
    pages,
    leafIndex: group.start + group.size - 1,
    next: groups[at + 1] ?? null,
    previous: groups[at - 1] ?? null,
  };
}
