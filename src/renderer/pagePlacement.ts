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
