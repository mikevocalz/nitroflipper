import {
  FilterMode, MipmapMode, Skia, TileMode,
  type SkImage, type SkShader,
} from '@shopify/react-native-skia';
import type { PageSource } from '../types';
import type { SpreadGroup } from './spreadPlan';
import { pagePlacement } from './pagePlacement';

export const PAGE_BACKGROUND = '#101010';

/** One immutable snapshot: geometry, direction readiness and native resources. */
export interface CurlFrame {
  revision: number;
  generation: number;
  width: number;
  height: number;
  rtl: boolean;
  /**
   * How far the turning leaf reaches from the hinge, in pixels -- the page
   * plus its half of the gutter, not the page's own width. A turn's progress
   * is the crease travelling that distance, so this is also what pointer
   * movement is normalized against.
   */
  forwardLeaf: number;
  backwardLeaf: number;
  next: number | null;
  previous: number | null;
  /**
   * Pages in each destination group, 0 when there is none. A leaf landing on a
   * spread has its printed back on the far page; one landing on a single
   * centred page has it on the leaf's own side, because that is where the
   * destination is drawn.
   */
  nextSize: number;
  previousSize: number;
  pages: number[];
  /**
   * Where each page of this group actually sits, in reading order.
   *
   * Magnification is scoped to one of these, so a pinch on the recto cannot
   * move the verso. Computed with the same slot rules `groupShaders` uses, so
   * the rect a gesture picks is the rect the page is drawn in.
   */
  panes: { x: number; y: number; width: number; height: number }[];
  children: SkShader[];
}

/**
 * Image shaders take their own native image references while the cache is pinned.
 * They are then safe to pass to the UI runtime without exposing SkImage wrappers
 * to a later React mount. Decal preserves the page's letterbox and gutter.
 */
export function groupShaders(
  source: PageSource,
  group: SpreadGroup | null,
  images: ReadonlyMap<number, SkImage>,
  width: number,
  height: number,
  gutter: number,
): SkShader[] {
  const shaders: SkShader[] = [];
  try {
    for (const side of ['left', 'right'] as const) {
      if (group === null) {
        shaders.push(Skia.Shader.MakeColor(Skia.Color(PAGE_BACKGROUND)));
        continue;
      }
      const rtl = source.progressionDirection === 'rtl';
      const offset = group.size === 1 ? 0 : (side === 'left') === !rtl ? 0 : 1;
      const index = group.start + offset;
      const image = images.get(index);
      if (!image) throw new Error(`Page ${index} is not ready for a turn`);
      const rect = pagePlacement(source.getPageBox(index),
        group.size === 1 ? 'center' : side, width, height, gutter);
      const matrix = Skia.Matrix().translate(rect.x, rect.y)
        .scale(rect.width / image.width(), rect.height / image.height());
      try {
        shaders.push(image.makeShaderOptions(
          TileMode.Decal, TileMode.Decal, FilterMode.Linear, MipmapMode.None, matrix));
      } finally {
        matrix.dispose();
      }
    }
    return shaders;
  } catch (error) {
    for (const shader of shaders) shader.dispose();
    throw error;
  }
}
