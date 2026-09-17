/**
 * Zoom geometry.
 *
 * One mapping, written once, used by the shader, the gestures and the hit
 * tests: a point on the fitted page maps to the viewport as
 *
 *   viewport = scale * fitted + translate
 *
 * `fitted` is the page as the reader lays it out at rest -- already letterboxed
 * into the viewport, already paired into a spread, already rotated. That is
 * what makes `scale = 1` mean "the fitted view" and not "the document's own
 * points", and it is why the zoom percentage the reader shows is honest
 * regardless of the document's page size.
 *
 * Every function here is a worklet: the gestures run them on the UI runtime at
 * frame rate, and the tests run them on the CPU. Keeping them pure is what
 * makes the focal-point behaviour checkable without a device.
 */
export interface ZoomTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const FIT: ZoomTransform = { scale: 1, x: 0, y: 0 };

/**
 * The rectangle magnification is confined to -- one reading pane.
 *
 * A spread is two leaves of a book that happen to be visible at once, not one
 * picture. Inspecting the recto must leave the verso where it is, so the zoom
 * is bounded and clipped to the page the gesture started on rather than to the
 * viewport. For a single centred page this is that page's own letterboxed
 * rect, which is also what keeps panning out of the margins.
 */
export interface ZoomBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Hold the page against the viewport.
 *
 * Enlarged, the page may not expose an edge: translation is bounded so the
 * scaled page still covers the viewport. Smaller than the viewport on an axis
 * -- which happens below fit, and on the short axis of a letterboxed page --
 * there is nothing to pan to, so it centres instead of drifting.
 */
export function clampZoom(
  transform: ZoomTransform,
  bounds: ZoomBounds,
): ZoomTransform {
  'worklet';
  const scale = transform.scale;
  // The magnified pane has to keep covering the pane. Its near edge may not
  // come inside the near edge, and its far edge may not come inside the far
  // edge, which is one interval per axis.
  // `+ 0` normalises -0, which a pane anchored at x=0 produces and which then
  // compares unequal to 0 anywhere Object.is is used.
  const near = (origin: number) => origin * (1 - scale) + 0;
  const farX = near(bounds.x + bounds.width);
  const farY = near(bounds.y + bounds.height);
  const nearX = near(bounds.x);
  const nearY = near(bounds.y);
  return {
    scale,
    // Below fit the interval inverts -- there is nothing to pan to -- so it
    // centres on the pane instead of drifting.
    x: farX > nearX ? near(bounds.x + bounds.width / 2)
      : Math.min(nearX, Math.max(farX, transform.x)),
    y: farY > nearY ? near(bounds.y + bounds.height / 2)
      : Math.min(nearY, Math.max(farY, transform.y)),
  };
}

/** The point on the fitted page currently under a viewport point. */
export function toFitted(transform: ZoomTransform, x: number, y: number) {
  'worklet';
  return {
    x: (x - transform.x) / transform.scale,
    y: (y - transform.y) / transform.scale,
  };
}

/** Where a point on the fitted page currently appears in the viewport. */
export function toViewport(transform: ZoomTransform, x: number, y: number) {
  'worklet';
  return {
    x: transform.scale * x + transform.x,
    y: transform.scale * y + transform.y,
  };
}

/**
 * Rescale about a viewport point, keeping the content under it in place.
 *
 * The anchor is read from the transform the gesture started with, not from the
 * live one. Reading it live while the pinch also reports focal movement counts
 * that movement twice and the page crawls out from under the fingers.
 */
export function zoomAbout(
  start: ZoomTransform,
  focalX: number,
  focalY: number,
  nextScale: number,
  bounds: ZoomBounds,
  limits: { min: number; max: number },
): ZoomTransform {
  'worklet';
  const scale = Math.min(limits.max, Math.max(limits.min, nextScale));
  const anchor = toFitted(start, focalX, focalY);
  return clampZoom(
    { scale, x: focalX - scale * anchor.x, y: focalY - scale * anchor.y },
    bounds,
  );
}

/** The pane a point falls in, or the nearest one when it lands in the gutter. */
export function paneAt(panes: readonly ZoomBounds[], x: number): ZoomBounds | null {
  'worklet';
  if (panes.length === 0) return null;
  let nearest = panes[0];
  let best = Infinity;
  for (let i = 0; i < panes.length; i++) {
    const pane = panes[i];
    if (x >= pane.x && x <= pane.x + pane.width) return pane;
    const distance = Math.min(Math.abs(x - pane.x), Math.abs(x - (pane.x + pane.width)));
    if (distance < best) { best = distance; nearest = pane; }
  }
  return nearest;
}

/**
 * Raster density to ask the document for at a given zoom.
 *
 * Quantised to powers of two so a pinch asks for at most a couple of distinct
 * rasters instead of a new one every frame, and rounded up so the request is
 * never softer than the screen. Capped two ways: by the caller's zoom ceiling,
 * and by what a texture can actually be -- a page rastered at 4x is 16x the
 * pixels, which is how a reader runs a device out of memory inspecting one
 * comic panel.
 */
export function rasterDensity(
  scale: number,
  pageWidth: number,
  pageHeight: number,
  maxTextureSide: number,
  maxDensity: number,
): number {
  'worklet';
  const wanted = Math.min(maxDensity, Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, scale)))));
  const side = Math.max(pageWidth, pageHeight);
  if (side <= 0) return 1;
  const affordable = Math.max(1, Math.floor(maxTextureSide / side));
  // Down to the next power of two that fits, never below 1.
  let density = wanted;
  while (density > 1 && density > affordable) density /= 2;
  return density;
}

/** Percentage the reader shows. 100% is the fitted page, not the document's own size. */
export function zoomPercent(scale: number): number {
  'worklet';
  return Math.round(scale * 100);
}
