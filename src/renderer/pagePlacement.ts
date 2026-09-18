import type { PageBox } from '../types';

/** Layout belongs to each group, including destinations with a different size. */
export function pagePlacement(
  box: PageBox,
  slot: 'left' | 'right' | 'center',
  width: number,
  height: number,
  gutter: number,
) {
  const slotWidth = slot === 'center' ? width : (width - gutter) / 2;
  const scale = Math.min(slotWidth / box.width, height / box.height);
  const w = box.width * scale;
  const h = box.height * scale;
  return {
    x: slot === 'center' ? (width - w) / 2
      : slot === 'left' ? width / 2 - gutter / 2 - w : width / 2 + gutter / 2,
    y: (height - h) / 2,
    width: w,
    height: h,
  };
}

/**
 * Where the turning leaf is hinged, and how far it reaches.
 *
 * A spread is hinged down the middle. A single centred page is hinged on its
 * own inner edge -- the side the turn pivots away from -- so the leaf is the
 * page and not half of an otherwise empty viewport. `leafSign` is +1 when the
 * leaf rests to the right of the hinge, -1 when it rests to the left.
 *
 * Runs on the UI runtime inside the shader's paint, and on the CPU in the
 * shader tests, so both read the same geometry.
 */
export function leafHinge(width: number, leafSpan: number, spread: boolean, leafSign: number) {
  'worklet';
  const leafW = Math.max(leafSpan, 1);
  return { spineX: spread ? width / 2 : (width - leafSign * leafW) / 2, leafW };
}
