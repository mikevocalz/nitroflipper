import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FixedPaginator } from '../FixedPaginator';
import { ReflowablePaginator, type Paragraph } from '../ReflowablePaginator';
import {
  locatorForPosition,
  resolvePosition,
} from '../PositionResolver';
import { shouldUseSpread } from '../SpreadPolicy';
import type { Locator } from '../../types';

const narrowViewport = { width: 400, height: 600 };
const wideViewport = { width: 1200, height: 600 };

function makeLocator(progression: number): Locator {
  return {
    href: 'urn:position',
    locations: { progression },
  };
}

function roundTripSingleSpread(
  paginator: FixedPaginator | ReflowablePaginator,
  fontSize: number,
  locator: Locator,
  rtl: boolean,
): number {
  const single1 = resolvePosition(
    paginator,
    narrowViewport,
    fontSize,
    'single',
    locator,
  );
  const loc2 = locatorForPosition(
    paginator,
    narrowViewport,
    fontSize,
    single1,
  );

  const spread = resolvePosition(
    paginator,
    wideViewport,
    fontSize,
    'spread',
    loc2,
  );
  const loc3 = locatorForPosition(
    paginator,
    wideViewport,
    fontSize,
    spread,
  );

  const single2 = resolvePosition(
    paginator,
    narrowViewport,
    fontSize,
    'single',
    loc3,
  );

  // The preserved locator should resolve to the same page once we return to
  // the original viewport/font size.
  if ('repaginate' in paginator) {
    paginator.repaginate(narrowViewport, fontSize);
  }
  const startPage = paginator.pageForLocator(locator);
  const endPage = single2.pageIndex;

  assert.equal(
    startPage,
    endPage,
    `round-trip failed for ${rtl ? 'RTL' : 'LTR'} at progression ${
      locator.locations?.progression
    } (fontSize ${fontSize})`,
  );
  return endPage;
}

describe('SpreadPolicy', () => {
  it('uses single page when two page-widths do not fit', () => {
    const pageBox = { width: 400, height: 600 };
    assert.equal(shouldUseSpread(narrowViewport, pageBox, 'both'), false);
  });

  it('uses spread when two page-widths fit', () => {
    const pageBox = { width: 400, height: 600 };
    assert.equal(shouldUseSpread(wideViewport, pageBox, 'both'), true);
  });
});

describe('Fixed layout round-trip', () => {
  function makePages(rtl: boolean): FixedPaginator {
    const pages = [
      { width: 400, height: 600, slot: 'center' as const },
      ...Array.from({ length: 8 }, () => ({
        width: 400,
        height: 600,
      })),
    ];
    return new FixedPaginator(pages, {
      progressionDirection: rtl ? 'rtl' : 'ltr',
      spreadIntent: 'both',
    });
  }

  it('preserves page index across single→spread→single in LTR', () => {
    const paginator = makePages(false);
    for (let i = 1; i < paginator.pageCount(); i += 1) {
      const locator = paginator.locatorForPage(i);
      roundTripSingleSpread(paginator, 16, locator, false);
    }
  });

  it('preserves page index across single→spread→single in RTL', () => {
    const paginator = makePages(true);
    for (let i = 1; i < paginator.pageCount(); i += 1) {
      const locator = paginator.locatorForPage(i);
      roundTripSingleSpread(paginator, 16, locator, true);
    }
  });
});

describe('Reflowable round-trip at three font sizes', () => {
  const paragraphs: Paragraph[] = [
    { id: 'ch1', text: 'a'.repeat(1200) },
    { id: 'ch2', text: 'b'.repeat(2500) },
    { id: 'ch3', text: 'c'.repeat(1300) },
  ];

  const fontSizes = [12, 16, 20];
  const progressions = [0.0, 0.37, 0.82, 0.999];

  for (const fontSize of fontSizes) {
    it(`fontSize=${fontSize}`, () => {
      const paginator = new ReflowablePaginator({
        paragraphs,
        progressionDirection: 'ltr',
        spreadIntent: 'auto',
      });

      for (const progression of progressions) {
        const locator = makeLocator(progression);
        roundTripSingleSpread(paginator, fontSize, locator, false);
      }
    });
  }
});
