import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, View } from 'react-native';
import { Canvas, Fill, Skia, type SkImage, type SkShader } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  cancelAnimation, useAnimatedReaction, useDerivedValue, useSharedValue,
  withSpring, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import type { PageSource } from '../types';
import { shouldUseSpread } from '../pagination/SpreadPolicy';
import { PAGE_CURL_SKSL } from './pageCurlShader';
import { PageTextureCache, textureBytes, type PageKey } from './PageTextureCache';
import { buildSpreadGroups, planSpreadAt, type SpreadGroup } from './spreadPlan';
import { FrameLifetime } from './FrameLifetime';
import { groupShaders, PAGE_BACKGROUND, type CurlFrame } from './curlFrame';
import { leafHinge, pagePlacement } from './pagePlacement';
import {
  clampZoom, FIT, paneAt, rasterDensity, zoomAbout,
  type ZoomBounds, type ZoomTransform,
} from './zoom';

interface PageCurlViewProps {
  source: PageSource;
  pageIndex: number;
  onPageIndexChange?: (index: number) => void;
  width: number;
  height: number;
  /**
   * Two pages side by side, curl on the outer leaf. Defaults to the
   * width test in SpreadPolicy (two page-widths fit the viewport).
   */
  spread?: boolean;
  /** Gap between display halves, for a dual-screen fold. */
  gutter?: number;
  /**
   * How the reader is currently paging: how many pages a turn moves, and
   * whether two are shown. Pairing depends on the page sizes, so anything
   * that also turns pages (a page control, a keyboard) must take the step
   * from here rather than assuming it.
   */
  onLayoutChange?: (info: { step: number; spread: boolean }) => void;
  /**
   * Turn the page as if flicked. `id` must change per request so repeated
   * turns in the same direction each animate.
   */
  turnRequest?: { dir: number; id: number };
  /**
   * Stable identity for the document being shown.
   *
   * Part of the texture cache key, so swapping documents cannot serve the
   * previous book's page 7 for the new book's page 7. Also scoped to the source
   * instance, so replacing an anonymous source cannot reuse another book's pages.
   */
  documentId?: string;
  /**
   * Hash of anything that changes pixels without changing the page: theme,
   * font size, user CSS. Part of the cache key.
   */
  appearance?: string;
  /**
   * Ceiling for decoded page textures, in bytes.
   *
   * Counting images is not a memory bound -- six tablet pages at 3x are not
   * six phone pages at 2x. Left unset, the budget is derived from the actual
   * raster size and the number of pages a turn needs resident, which is the
   * only way it cannot be smaller than the working set.
   */
  textureBudgetBytes?: number;
  /**
   * Called once the UI runtime has built the replacement page's native paint.
   * Use this for page labels instead of the earlier requested index. This is
   * a submission acknowledgement; the independently composited SurfaceView
   * does not provide a presentation fence for React chrome.
   */
  onSpreadVisible?: (pages: readonly number[]) => void;
  /**
   * Called when a page fails to load.
   *
   * Without this a rejection inside the loader is an unhandled promise and the
   * reader just stays blank -- no page, no error, nothing to act on.
   */
  onPageLoadError?: (error: unknown) => void;
  /**
   * Pinch, double-tap and drag-to-pan magnification.
   *
   * `1` is the fitted page -- what the reader shows at rest -- so the
   * percentage a user sees is honest whatever the document's own page size is.
   * Set `max` to 1 to switch magnification off entirely.
   */
  zoom?: {
    /** Largest magnification. Default 4. */
    max?: number;
    /** What a double tap goes to, and back from. Default 2. */
    doubleTap?: number;
    /** Skip the animated transitions for double-tap and fit. */
    reducedMotion?: boolean;
  };
  /**
   * Called when magnification settles, not per frame.
   *
   * Fires after a pinch or double tap comes to rest, so chrome can show a
   * percentage without re-rendering the reader sixty times a second.
   */
  onZoomChange?: (zoom: { scale: number; x: number; y: number }) => void;
  /**
   * Zoom as if the reader had pinched. `id` must change per request so
   * repeated presses of the same control each take effect.
   *
   * `in` and `out` step by a factor of two; a number is an absolute scale where
   * 1 is the fitted page. Anchored on the centre of the pane being inspected,
   * or the first page in reading order when nothing has been claimed yet.
   */
  zoomRequest?: { to: number | 'in' | 'out' | 'fit'; id: number };
}

const FLICK_VELOCITY = 400;
/** Past this the reader is magnified: one finger pans instead of turning. */
const ZOOMED = 1.01;
/**
 * Largest page raster we will ask for, per side.
 *
 * A page rastered at 4x is 16x the pixels, which is how a reader runs a device
 * out of memory inspecting a single comic panel. GLES guarantees only 2048;
 * every target here does 8192, and `rasterDensity` steps down to whatever
 * power of two actually fits rather than failing to allocate mid-pinch.
 */
const MAX_TEXTURE_SIDE = 8192;
const COMMIT_AT = 0.5;
const MAX_RELEASE_SPEED = 3;
const sourceIds = new WeakMap<PageSource, number>();
let nextSourceId = 1;

function sourceId(source: PageSource): number {
  let id = sourceIds.get(source);
  if (id === undefined) {
    id = nextSourceId++;
    sourceIds.set(source, id);
  }
  return id;
}

function pagesOf(group: SpreadGroup | null): number[] {
  return group ? Array.from({ length: group.size }, (_, i) => group.start + i) : [];
}

export function PageCurlView({
  source, pageIndex, onPageIndexChange, width, height,
  spread: spreadProp, gutter = 0, onLayoutChange, turnRequest,
  documentId = 'default', appearance = 'default', textureBudgetBytes,
  onSpreadVisible, onPageLoadError, zoom: zoomOptions, onZoomChange, zoomRequest,
}: PageCurlViewProps) {
  const effect = useMemo(() => Skia.RuntimeEffect.Make(PAGE_CURL_SKSL), []);
  const progress = useSharedValue(0);
  // Frames the reader can land on without waiting for React. See stageLanding.
  const landingAhead = useSharedValue<CurlFrame | null>(null);
  const landingBehind = useSharedValue<CurlFrame | null>(null);
  const consumed = useRef(new Set<number>());
  const dir = useSharedValue(1);
  const turning = useSharedValue(true);
  const dragging = useSharedValue(false);
  const requested = useSharedValue(0);
  const frame = useSharedValue<CurlFrame | null>(null);
  // Frames that could not be painted because their native children were gone.
  // Should stay at zero; a non-zero count is a lifetime bug, not a slow device.
  const released = useSharedValue(0);
  // The live view transform, and the copy a gesture started from. Anchoring a
  // pinch against the live one while the focal point also moves counts that
  // movement twice and the page crawls out from under the fingers.
  const view = useSharedValue<ZoomTransform>(FIT);
  const viewStart = useSharedValue<ZoomTransform>(FIT);
  // Pointer count at the last pan sample. A change means a finger arrived or
  // left, so the pan rebases instead of jumping by the whole new translation.
  const panFrom = useSharedValue({ x: 0, y: 0, pointers: 0 });
  const panning = useSharedValue(false);
  // The view the pan is measured from, re-taken whenever the finger count
  // changes so nothing jumps as a finger arrives or leaves.
  const panBase = useSharedValue<ZoomTransform>(FIT);
  // Double-tap animation. Interpolating between two already-legal transforms
  // and clamping each frame means the page cannot leave its bounds part-way.
  const morph = useSharedValue(1);
  const morphFrom = useSharedValue<ZoomTransform>(FIT);
  const morphTo = useSharedValue<ZoomTransform>(FIT);
  // The pane the current magnification belongs to. Whole viewport until a
  // gesture picks one, so an un-zoomed reader behaves exactly as before.
  const pane = useSharedValue<ZoomBounds>({ x: 0, y: 0, width: 0, height: 0 });
  const epoch = useRef(0);
  const travel = useRef(1);
  const lifetime = useRef(new FrameLifetime()).current;
  const cache = useRef(new PageTextureCache({ budgetBytes: 0 })).current;
  // Serialize native reads across cancelled effects as well as within a load.
  const decodeTail = useRef<Promise<void>>(Promise.resolve());
  const callbacks = useRef({ onPageIndexChange, onSpreadVisible, onPageLoadError });
  callbacks.current = { onPageIndexChange, onSpreadVisible, onPageLoadError };
  const notifiedGeneration = useRef(0);
  const generations = (source as PageSource & {
    generations?: { document: number; layout: number };
  }).generations ?? { document: 0, layout: 0 };
  const identity = `${sourceId(source)}:${encodeURIComponent(documentId)}`;
  const screen = PixelRatio.get();
  // Extra raster density asked of the document while magnified. Quantised to
  // powers of two and only republished when a gesture settles, so a pinch asks
  // for at most a couple of rasters instead of one per frame. It lands in the
  // texture cache key through renderWidth/renderHeight, so an old density can
  // never be served for a new one.
  const [density, setDensity] = useState(1);
  const scale = screen * density;
  const rtl = source.progressionDirection === 'rtl';
  const groups = useMemo(() => buildSpreadGroups(
    source.pageCount,
    (index) => shouldUseSpread({ width, height }, source.getPageBox(index), 'auto'),
    spreadProp ?? true,
  ), [source, source.pageCount, width, height, spreadProp,
    generations.document, generations.layout]);
  const plan = planSpreadAt(groups, pageIndex);
  const { step, spread } = plan;
  useEffect(() => { onLayoutChange?.({ step, spread }); }, [onLayoutChange, step, spread]);

  useAnimatedReaction(
    () => morph.value,
    (t) => {
      if (t >= 1) return;
      const a = morphFrom.value;
      const b = morphTo.value;
      view.value = clampZoom({
        scale: a.scale + (b.scale - a.scale) * t,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      }, pane.value);
    }, [],
  );

  const recorded = useCallback((revision: number, generation: number, pages: number[]) => {
    lifetime.recorded(revision);
    if (generation !== epoch.current || notifiedGeneration.current === generation) return;
    notifiedGeneration.current = generation;
    callbacks.current.onSpreadVisible?.(pages);
  }, [lifetime]);
  const discard = useCallback((revision: number) => lifetime.discard(revision), [lifetime]);

  // A single native paint is the handoff boundary. The runtime shader takes
  // independent native references to all six children BEFORE an older frame's
  // wrappers can be released. Skia consumes one animated paint, so it cannot
  // observe new textures with the previous progress (or the reverse).
  const rendered = useDerivedValue(() => {
    const current = frame.value;
    // A fresh paint every frame is load-bearing, not waste: `paint` is the only
    // shared value in the Skia tree, and Reanimated drops a write whose value is
    // identical to the last one, so a pooled instance would never mark Skia's
    // container mapper dirty and the canvas would freeze on frame one.
    const paint = Skia.Paint();
    let shaded = false;
    if (current && effect) {
      // Which leaf is hinged, and where. A spread hinges down the middle; a
      // single centred page hinges on its own inner edge, so the leaf is the
      // page rather than half an otherwise empty viewport.
      const leafSign = current.rtl ? -dir.value : dir.value;
      const { spineX, leafW } = leafHinge(current.width,
        dir.value > 0 ? current.forwardLeaf : current.backwardLeaf,
        current.pages.length > 1, leafSign);
      const landingSize = dir.value > 0 ? current.nextSize : current.previousSize;
      // Seatbelt, not the mechanism. FrameLifetime's hold/taken rules are what
      // keep a frame's children alive while anything still points at it; if
      // one is released early anyway, Skia throws "Attempted to access a
      // disposed object" from here and the error takes the whole surface down
      // with it. A reader that loses its page on a resize is a bug; a reader
      // that shows the page background for one frame is a glitch.
      try {
        const magnified = view.value;
        const shader = effect.makeShaderWithChildren([
          progress.value, current.width / 2, dir.value, spineX, leafW, leafSign,
          landingSize > 1 ? -leafSign : leafSign,
          magnified.scale, magnified.x, magnified.y,
          pane.value.x, pane.value.y,
          pane.value.x + pane.value.width, pane.value.y + pane.value.height,
        ], current.children);
        paint.setShader(shader);
        shader.dispose();
        shaded = true;
      } catch {
        released.value += 1;
      }
    }
    // A bound shader makes the paint's colour dead, so setting one on the normal
    // path costs a CSS parse and a Float32Array every frame for a value nothing
    // reads. It is only visible on the two fallbacks above -- no frame yet, or a
    // disposed child -- where it still has to be the page background.
    if (!shaded) paint.setColor(Skia.Color(PAGE_BACKGROUND));
    return { paint, revision: current?.revision ?? 0,
      generation: current?.generation ?? 0, pages: current?.pages ?? [] };
  });
  const paint = useDerivedValue(() => rendered.value.paint);
  useAnimatedReaction(
    () => rendered.value,
    (current, previous) => {
      if (current.revision && current.revision !== previous?.revision) {
        scheduleOnRN(recorded, current.revision, current.generation, current.pages);
      }
    }, [recorded],
  );

  const commit = useCallback((generation: number, target: number, forward: boolean,
    landed: number) => {
    // A landing that is now on screen must not be discarded when this load is
    // superseded -- the frame drawing it owns those shaders.
    if (landed !== 0) {
      consumed.current.add(landed);
      lifetime.taken(landed);
    }
    if (generation !== epoch.current) return;
    travel.current = forward ? 1 : -1;
    callbacks.current.onPageIndexChange?.(target);
  }, [lifetime]);

  useEffect(() => {
    const generation = ++epoch.current;
    let cancelled = false;
    const staged: number[] = [];
    // The landing currently held for each direction. Rebuilding one has to
    // retire the frame it replaces: nothing else will, now that a held
    // revision is exempt from the sweep.
    const stagedFor = { forward: 0, backward: 0 };
    const retained = new Map<number, { key: PageKey; image: SkImage }>();
    const here: SpreadGroup = { start: plan.pages[0], size: plan.step };
    let nextReady = false;
    let previousReady = false;
    scheduleOnUI(() => {
      'worklet';
      requested.value = generation;
      cancelAnimation(progress);
      turning.value = true;
      dragging.value = false;
    });

    const cancelLoad = () => {
      cancelled = true;
      if (epoch.current === generation) epoch.current += 1;
      for (const revision of staged) {
        // A landing the reader never took still owns shaders and cache holds.
        if (!consumed.current.has(revision)) lifetime.discard(revision);
        consumed.current.delete(revision);
      }
      scheduleOnUI(() => {
        'worklet';
        landingAhead.value = null;
        landingBehind.value = null;
        if (requested.value !== generation) return;
        requested.value = 0;
        cancelAnimation(progress);
        turning.value = true;
        dragging.value = false;
      });
    };
    if (source.pageCount === 0 || width <= 0 || height <= 0) {
      const revision = lifetime.stage(() => undefined);
      cache.clear();
      scheduleOnUI(() => {
        'worklet';
        frame.value = null;
        progress.value = 0;
        scheduleOnRN(recorded, revision, generation, []);
      });
      return cancelLoad;
    }

    const placement = (index: number) => pagePlacement(source.getPageBox(index),
      planSpreadAt(groups, index).spread ? 'right' : 'center', width, height, gutter);
    const keyFor = (index: number): PageKey => {
      const rect = placement(index);
      return { documentId: identity, documentGeneration: generations.document,
        layoutGeneration: generations.layout, pageIndex: index,
        renderWidth: Math.max(1, Math.ceil(rect.width * scale)),
        renderHeight: Math.max(1, Math.ceil(rect.height * scale)), rotation: 0, appearance };
    };
    const inFlight = [...pagesOf(here), ...pagesOf(plan.next), ...pagesOf(plan.previous)];
    const budget = textureBudgetBytes ?? Math.max(32 * 1024 * 1024,
      Math.ceil(1.5 * inFlight.reduce((bytes, index) => {
        const key = keyFor(index);
        return bytes + textureBytes(key.renderWidth, key.renderHeight);
      }, 0)));
    cache.setBudget(budget);
    cache.invalidateExcept(identity, generations.document, generations.layout);

    const cached = (index: number): SkImage | null => {
      if (cancelled) return null;
      const existing = retained.get(index);
      if (existing) return existing.image;
      const key = keyFor(index);
      const image = cache.retain(key);
      if (image) retained.set(index, { key, image });
      return image;
    };
    const read = (index: number): Promise<SkImage | null> => {
      const task = decodeTail.current.then(async () => {
        if (cancelled) return null;
        const hit = cached(index);
        if (hit) return hit;
        const key = keyFor(index);
        const bytes = await source.readPageScaled(index, key.renderWidth, key.renderHeight);
        if (cancelled) return null;
        const data = Skia.Data.fromBytes(new Uint8Array(bytes));
        let image: SkImage | null;
        try { image = Skia.Image.MakeImageFromEncoded(data); }
        finally { data.dispose(); }
        if (!image) throw new Error(`Could not decode page ${index}`);
        const stored = cache.setAndRetain(key, image,
          textureBytes(key.renderWidth, key.renderHeight));
        retained.set(index, { key, image: stored });
        return stored;
      });
      decodeTail.current = task.then(() => undefined, () => undefined);
      return task;
    };
    const loadGroup = async (group: SpreadGroup | null) => {
      for (const index of pagesOf(group)) {
        if (cancelled) return;
        await read(index);
      }
    };
    // Measured from the hinge: the gutter is dead space carried by the leaf,
    // and the crease has to cross it before the page starts to lift.
    const leafSpan = (index: number, spread: boolean) =>
      placement(index).width + (spread ? gutter / 2 : 0);
    const isCached = (group: SpreadGroup | null) =>
      group !== null && pagesOf(group).every((index) => cached(index) !== null);

    const frameFor = (
      base: SpreadGroup,
      ahead: SpreadGroup | null,
      behind: SpreadGroup | null,
    ): CurlFrame => {
      const children: SkShader[] = [];
      const keys: PageKey[] = [];
      try {
        const images = new Map<number, SkImage>();
        for (const [index, entry] of retained) {
          if (!cache.retain(entry.key)) throw new Error(`Lost page ${index}`);
          keys.push(entry.key);
          images.set(index, entry.image);
        }
        for (const group of [base, ahead, behind]) {
          children.push(...groupShaders(source, group, images, width, height, gutter));
        }
      } catch (error) {
        for (const shader of children) shader.dispose();
        for (const key of keys) cache.release(key);
        throw error;
      }
      const revision = lifetime.stage(() => {
        for (const shader of children) shader.dispose();
        for (const key of keys) cache.release(key);
      });
      return {
        revision, generation, width, height, rtl, children, pages: pagesOf(base),
        // Same slot rules groupShaders uses, so the rect a gesture claims is
        // the rect the page is actually drawn in.
        panes: pagesOf(base).map((index, order) => pagePlacement(
          source.getPageBox(index),
          base.size === 1 ? 'center' : (order === 0) === !rtl ? 'left' : 'right',
          width, height, gutter)),
        forwardLeaf: leafSpan(base.start + base.size - 1, base.size > 1),
        backwardLeaf: leafSpan(base.start, base.size > 1),
        next: ahead?.start ?? null,
        previous: behind?.start ?? null,
        nextSize: ahead?.size ?? 0,
        previousSize: behind?.size ?? 0,
      };
    };

    const install = (current: CurlFrame, reset: boolean) => {
      const revision = current.revision;
      if (cancelled) {
        lifetime.discard(revision);
        return;
      }
      scheduleOnUI(() => {
        'worklet';
        if (requested.value !== generation) {
          scheduleOnRN(discard, revision);
          return;
        }
        frame.value = current;
        if (reset) {
          cancelAnimation(progress);
          progress.value = 0;
          turning.value = false;
          dragging.value = false;
        }
      });
    };

    /**
     * The frame the reader lands on, built before the turn commits.
     *
     * Committing used to hand the turn back to React: set the page index,
     * re-render, re-run this effect, rebuild six shaders, publish. Measured on
     * a Surface Duo that is 64ms in which the panel presents nothing while the
     * page sits fully curled -- the one long gap in every turn. The landing
     * frame is ready before the finger lets go, so the commit is a single
     * assignment on the UI thread and React only has to catch up afterwards.
     */
    const stageLanding = (forward: boolean) => {
      if (cancelled) return;
      const group = forward ? plan.next : plan.previous;
      if (group === null || !isCached(group)) return;
      const onward = planSpreadAt(groups, group.start);
      const ahead = forward ? onward.next : here;
      const behind = forward ? here : onward.previous;
      const ready = (candidate: SpreadGroup | null) =>
        candidate === null ? null : isCached(candidate) ? candidate : null;
      let landing: CurlFrame;
      try {
        landing = frameFor(group, ready(ahead), ready(behind));
      } catch {
        // A page went out of the cache between the check and the build; the
        // turn still works, it just goes the slow way through React.
        return;
      }
      const superseded = forward ? stagedFor.forward : stagedFor.backward;
      if (superseded !== 0 && !consumed.current.has(superseded)) {
        lifetime.discard(superseded);
      }
      if (forward) stagedFor.forward = landing.revision;
      else stagedFor.backward = landing.revision;
      lifetime.hold(landing.revision);
      staged.push(landing.revision);
      scheduleOnUI(() => {
        'worklet';
        if (requested.value !== generation) {
          scheduleOnRN(discard, landing.revision);
          return;
        }
        if (forward) landingAhead.value = landing;
        else landingBehind.value = landing;
      });
    };

    void (async () => {
      if (!effect) throw new Error('Could not compile the page curl shader');
      await loadGroup(here);
      if (cancelled) return;
      // Keep cached destinations attached on landing. Never replace them with
      // current-page placeholders while decoding an unrelated neighbour.
      nextReady = isCached(plan.next);
      previousReady = isCached(plan.previous);
      install(frameFor(here, nextReady ? plan.next : null,
        previousReady ? plan.previous : null), true);
      stageLanding(travel.current >= 0);
      stageLanding(travel.current < 0);
      const directions = travel.current >= 0 ? [true, false] : [false, true];
      for (const forward of directions) {
        if (cancelled) return;
        const group = forward ? plan.next : plan.previous;
        if (group === null || (forward ? nextReady : previousReady)) continue;
        try {
          await loadGroup(group);
          if (cancelled) return;
          if (forward) nextReady = true;
          else previousReady = true;
          install(frameFor(here, nextReady ? plan.next : null,
            previousReady ? plan.previous : null), false);
          stageLanding(forward);
        } catch (error) {
          if (!cancelled) callbacks.current.onPageLoadError?.(error);
        }
      }
      // One group beyond the next turn, following the reader's direction.
      const adjacent = travel.current >= 0 ? plan.next : plan.previous;
      if (adjacent && !cancelled) {
        const beyond = planSpreadAt(groups, adjacent.start);
        await loadGroup(travel.current >= 0 ? beyond.next : beyond.previous);
      }
    })().catch((error) => {
      if (!cancelled) callbacks.current.onPageLoadError?.(error);
    }).finally(() => {
      for (const { key } of retained.values()) cache.release(key);
      retained.clear();
    });
    return cancelLoad;
    // Callbacks are read from a ref; replacing chrome callbacks must not reload pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, identity, pageIndex, groups, width, height, gutter, scale, appearance,
    textureBudgetBytes, generations.document, generations.layout, effect]);

  useEffect(() => () => {
    // Retire only revisions from this mount. StrictMode can start another load
    // before this UI task is acknowledged; its newer revisions must survive.
    const tombstone = lifetime.stage(() => undefined);
    cache.clear();
    scheduleOnUI(() => {
      'worklet';
      cancelAnimation(progress);
      frame.value = null;
      scheduleOnRN(recorded, tombstone, 0, []);
    });
  }, [cache, frame, lifetime, progress, recorded]);

  // Turning to another page starts fitted. Carrying a 4x magnification of the
  // top-left corner onto the next page shows the reader a crop of something
  // they have not seen yet.
  useEffect(() => {
    scheduleOnUI(() => {
      'worklet';
      morph.value = 1;
      view.value = FIT;
      viewStart.value = FIT;
    });
    setDensity(1);
  }, [pageIndex, identity, morph, view, viewStart]);

  // A resize -- rotation, a fold, a window change -- keeps the magnification
  // and re-legalises it against the new viewport, rather than throwing away
  // what the reader was inspecting.
  useEffect(() => {
    scheduleOnUI(() => {
      'worklet';
      // The pane moved with the viewport, so re-legalise against the new one.
      pane.value = { x: 0, y: 0, width, height };
      view.value = clampZoom(view.value, pane.value);
      viewStart.value = view.value;
    });
  }, [width, height, view, viewStart, pane]);

  const zoomRequestId = zoomRequest?.id ?? 0;
  const zoomTarget = zoomRequest?.to ?? 'fit';
  useEffect(() => {
    if (zoomRequestId === 0) return;
    scheduleOnUI(() => {
      'worklet';
      const current = frame.value;
      if (pane.value.width === 0) {
        // Nothing claimed yet: inspect the page that is read first, not both
        // halves of the spread at once.
        pane.value = current && current.panes.length > 0
          ? current.panes[0] : { x: 0, y: 0, width, height };
      }
      const now = view.value.scale;
      const target = zoomTarget === 'fit' ? 1
        : zoomTarget === 'in' ? now * 2
          : zoomTarget === 'out' ? now / 2
            : zoomTarget;
      const box = pane.value;
      const next = zoomAbout(view.value, box.x + box.width / 2, box.y + box.height / 2,
        target, box, zoomLimits);
      if (reducedMotion) {
        view.value = next;
        viewStart.value = next;
          return;
      }
      morphFrom.value = view.value;
      morphTo.value = next;
      morph.value = 0;
      morph.value = withTiming(1, { duration: 200 }, (done) => {
        if (!done) return;
        view.value = morphTo.value;
        viewStart.value = morphTo.value;
        });
    });
    // Each request is consumed once; unrelated re-renders must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomRequestId]);

  const requestId = turnRequest?.id ?? 0;
  const requestDir = turnRequest?.dir ?? 1;
  const canTurn = onPageIndexChange !== undefined;
  useEffect(() => {
    if (requestId === 0 || !canTurn) return;
    scheduleOnUI(() => {
      'worklet';
      const current = frame.value;
      const forward = requestDir > 0;
      const target = forward ? current?.next : current?.previous;
      if (!current || current.generation !== requested.value || turning.value ||
        dragging.value || target == null) return;
      dir.value = forward ? 1 : -1;
      progress.value = 0;
      turning.value = true;
      progress.value = withTiming(1, { duration: 320 }, (finished) => {
        if (finished) {
          scheduleOnRN(commit, current.generation, target, forward,
            land(forward, target));
        }
      });
    });
    // Each request is consumed once; readiness changes must not replay a tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  /**
   * Show the pre-built landing frame, if the reader is turning to it.
   *
   * Returns the revision taken, so the load that staged it knows not to throw
   * it away. Zero means there was none and the turn goes the slow way: React
   * re-renders, the loader rebuilds the shaders, and the panel shows the same
   * fully-curled page until it lands.
   */
  const land = (forward: boolean, target: number) => {
    'worklet';
    const landing = forward ? landingAhead.value : landingBehind.value;
    landingAhead.value = null;
    landingBehind.value = null;
    if (!landing || landing.pages[0] !== target) return 0;
    frame.value = landing;
    progress.value = 0;
    turning.value = false;
    dragging.value = false;
    return landing.revision;
  };


  const maxZoom = Math.max(1, zoomOptions?.max ?? 4);
  const doubleTapZoom = Math.min(maxZoom, Math.max(1, zoomOptions?.doubleTap ?? 2));
  const reducedMotion = zoomOptions?.reducedMotion ?? false;
  const zoomLimits = useMemo(() => ({ min: 1, max: maxZoom }), [maxZoom]);

  /**
   * Republish the settled magnification.
   *
   * Only on settle, never per frame: the transform itself lives on the UI
   * runtime and the shader reads it there. This exists so chrome can show a
   * percentage and so the loader can re-raster at a density worth having.
   */
  /**
   * Republish the settled magnification.
   *
   * Only on settle, never per frame: the transform itself lives on the UI
   * runtime and the shader reads it there. This exists so chrome can show a
   * percentage and so the loader can re-raster at a density worth having.
   *
   * Reads its inputs from a ref and takes no dependencies, because every
   * gesture below is memoised against it. Depending on `plan.pages` -- a fresh
   * array each render -- rebuilt all three gesture objects on every render,
   * re-attaching the recognizers underneath a pinch that was still in progress
   * and losing its end callback with them.
   */
  const zoomInputs = useRef({
    onZoomChange, source, pages: plan.pages, spread: plan.spread,
    width, height, gutter, screen, maxZoom,
  });
  zoomInputs.current = {
    onZoomChange, source, pages: plan.pages, spread: plan.spread,
    width, height, gutter, screen, maxZoom,
  };
  const settled = useCallback((scaleNow: number, x: number, y: number) => {
    const it = zoomInputs.current;
    it.onZoomChange?.({ scale: scaleNow, x, y });
    const page = pagePlacement(it.source.getPageBox(it.pages[0]),
      it.spread ? 'right' : 'center', it.width, it.height, it.gutter);
    setDensity(rasterDensity(scaleNow, page.width * it.screen, page.height * it.screen,
      MAX_TEXTURE_SIDE, it.maxZoom));
  }, []);

  /**
   * Report the settled magnification.
   *
   * Driven by watching the transform itself, not by a gesture's end callback.
   * A pinch that is cancelled by the system, or whose end callback never runs
   * -- which is what a release build does here, while the same code reports
   * fine in debug -- would otherwise leave the reader showing 100% over a
   * visibly magnified page.
   *
   * The UI runtime calls out only when the scale crosses a 5% step, and the JS
   * side coalesces those into one update once movement stops. Nothing renders
   * per frame.
   */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useCallback(() => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      // Read the transform itself for the final figure rather than the value
      // from the last 5% step the reaction reported. Otherwise a pinch that
      // stops at 107% shows 103% -- the step it last crossed. This is the one
      // blocking cross-runtime read in the path; it happens once a gesture
      // settles, never per frame.
      const exact = view.value;
      settled(exact.scale, exact.x, exact.y);
    }, 140);
  }, [settled, view]);
  useEffect(() => () => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
  }, []);

  useAnimatedReaction(
    () => Math.round(view.value.scale * 20),
    (step, previous) => {
      if (previous === null || step === previous) return;
      scheduleOnRN(moved);
    }, [moved],
  );

  /**
   * Claim the pane a gesture started on.
   *
   * Already inspecting a pane keeps it, so a stray finger cannot switch pages
   * out from under a pinch. Starting on a different page switches to it fitted,
   * because the transform is expressed against the old pane's rect and carrying
   * it across would open the new page cropped to wherever the last one was.
   */
  const claimPane = useCallback((x: number, y: number) => {
    'worklet';
    const box = pane.value;
    const inside = box.width > 0
      && x >= box.x && x <= box.x + box.width
      && y >= box.y && y <= box.y + box.height;
    if (view.value.scale > ZOOMED && inside) return;
    const current = frame.value;
    const picked = current ? paneAt(current.panes, x) : null;
    const next = picked ?? { x: 0, y: 0, width, height };
    if (next.x !== box.x || next.width !== box.width) {
      view.value = FIT;
      viewStart.value = FIT;
    }
    pane.value = next;
  }, [frame, pane, view, viewStart, width, height]);

  const pinch = useMemo(() => Gesture.Pinch()
    .onStart((event) => {
      claimPane(event.focalX, event.focalY);
      // Focal data is only meaningful once the gesture has activated, so the
      // anchor is captured here rather than in onBegin.
      viewStart.value = view.value;
      cancelAnimation(progress);
      // A pinch during an uncommitted curl abandons the turn rather than
      // magnifying a half-curled page and freezing that as the surface.
      if (dragging.value && !turning.value) {
        dragging.value = true;
        turning.value = true;
        progress.value = withTiming(0, { duration: 140 }, (done) => {
          if (done) { turning.value = false; dragging.value = false; }
        });
      }
    })
    .onUpdate((event) => {
      view.value = zoomAbout(viewStart.value, event.focalX, event.focalY,
        viewStart.value.scale * event.scale, pane.value, zoomLimits);
    })
    .onFinalize(() => {
      // onFinalize, not onEnd: a pinch cancelled by the system still left the
      // page somewhere, and the readout must agree with what is on screen.
      viewStart.value = view.value;
    }), [claimPane, zoomLimits, view, viewStart, pane, progress, dragging, turning]);

  const doubleTap = useMemo(() => Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd((event) => {
      // Toggle: magnified goes back to fit, fitted goes to the target anchored
      // on what was tapped, so the thing you pointed at is what you get.
      claimPane(event.x, event.y);
      const target = view.value.scale > ZOOMED ? 1 : doubleTapZoom;
      const next = zoomAbout(view.value, event.x, event.y, target,
        pane.value, zoomLimits);
      if (reducedMotion) {
        view.value = next;
        viewStart.value = next;
          return;
      }
      morphFrom.value = view.value;
      morphTo.value = next;
      morph.value = 0;
      morph.value = withTiming(1, { duration: 220 }, (done) => {
        if (!done) return;
        // Land exactly on the target. The reaction below stops writing at
        // t >= 1, so without this the transform keeps the last interpolated
        // value -- a hair above 1 after a fit, which still reads as magnified
        // and quietly turns every page-turn swipe into a 13px pan.
        view.value = morphTo.value;
        viewStart.value = morphTo.value;
        });
    }), [doubleTapZoom, claimPane, zoomLimits, reducedMotion, pane,
      view, viewStart, morph, morphFrom, morphTo]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-8, 8]).failOffsetY([-24, 24])
    .onStart((event) => {
      // Magnified, one finger inspects the page instead of turning it.
      // Reaching an edge stops at the edge; it does not quietly become a turn.
      //
      // Only within the pane being inspected, though. A drag that starts on
      // the facing page is about that page, and panning the magnified one
      // from over there moves a page the finger is nowhere near.
      const box = pane.value;
      const onPane = event.x >= box.x && event.x <= box.x + box.width
        && event.y >= box.y && event.y <= box.y + box.height;
      if (view.value.scale > ZOOMED && onPane) {
        panning.value = true;
        panBase.value = view.value;
        panFrom.value = { x: 0, y: 0, pointers: event.numberOfPointers };
        return;
      }
      const current = frame.value;
      if (!canTurn || !current || turning.value || current.generation !== requested.value) return;
      const forward = current.rtl ? event.x < current.width / 2 : event.x > current.width / 2;
      if ((forward ? current.next : current.previous) === null) return;
      dragging.value = true;
      dir.value = forward ? 1 : -1;
      progress.value = 0;
    })
    .onUpdate((event) => {
      if (panning.value) {
        const pointers = event.numberOfPointers;
        if (pointers !== panFrom.value.pointers) {
          // A finger arrived or left. Rebase on the transform as it stands, or
          // the page leaps by the whole translation accumulated so far.
          panBase.value = view.value;
          panFrom.value = { x: event.translationX, y: event.translationY, pointers };
          return;
        }
        // Two fingers belong to the pinch, which is already moving the page by
        // its focal point. Panning them as well would move it twice.
        if (pointers > 1) return;
        view.value = clampZoom({
          scale: panBase.value.scale,
          x: panBase.value.x + event.translationX - panFrom.value.x,
          y: panBase.value.y + event.translationY - panFrom.value.y,
        }, pane.value);
        return;
      }
      const current = frame.value;
      if (!dragging.value || !current || turning.value) return;
      if (event.numberOfPointers > 1) {
        // A second finger landed mid-drag: that is a pinch, not a turn. Give
        // the page back rather than magnifying a half-curled leaf.
        dragging.value = false;
        turning.value = true;
        progress.value = withTiming(0, { duration: 140 }, (done) => {
          if (done) turning.value = false;
        });
        return;
      }
      const forward = dir.value > 0;
      const sign = (forward !== current.rtl) ? -1 : 1;
      const leafWidth = forward ? current.forwardLeaf : current.backwardLeaf;
      progress.value = Math.min(Math.max(event.translationX * sign / leafWidth, 0), 1);
    })
    .onEnd((event) => {
      if (panning.value) {
        panning.value = false;
        viewStart.value = view.value;
          return;
      }
      const current = frame.value;
      if (!dragging.value || !current || turning.value) return;
      dragging.value = false;
      const forward = dir.value > 0;
      const target = forward ? current.next : current.previous;
      const away = event.velocityX * (forward !== current.rtl ? -1 : 1);
      const shouldCommit = target !== null && (Math.abs(away) > FLICK_VELOCITY
        ? away > 0 : progress.value > COMMIT_AT);
      const leafWidth = forward ? current.forwardLeaf : current.backwardLeaf;
      const velocity = Math.max(-MAX_RELEASE_SPEED, Math.min(away / leafWidth, MAX_RELEASE_SPEED));
      turning.value = true;
      progress.value = withSpring(shouldCommit ? 1 : 0, {
        velocity: shouldCommit ? Math.max(velocity, 0) : Math.min(velocity, 0),
        damping: shouldCommit ? 26 : 22, stiffness: shouldCommit ? 260 : 200,
        overshootClamping: true,
      }, (finished) => {
        if (!finished) return;
        if (shouldCommit && target !== null) {
          scheduleOnRN(commit, current.generation, target, forward,
            land(forward, target));
        } else turning.value = false;
      });
    })
    .onFinalize(() => {
      if (panning.value) {
        panning.value = false;
        viewStart.value = view.value;
        return;
      }
      if (!dragging.value) return;
      dragging.value = false;
      turning.value = true;
      progress.value = withSpring(0, { damping: 22, stiffness: 200, overshootClamping: true },
        (finished) => { if (finished) turning.value = false; });
    }), [canTurn, commit, frame, view, viewStart, panning, pane,
      panBase, panFrom, dragging, turning, dir, progress, requested]);

  // Race, not Exclusive: a double tap and a drag cannot both be meant, but
  // the pan needs 8px of travel to activate so a tap never reaches it -- and
  // making the turn wait for the double-tap window to expire would put a
  // visible delay on every page turn.
  const gesture = useMemo(
    () => Gesture.Race(doubleTap, Gesture.Simultaneous(pan, pinch)),
    [doubleTap, pan, pinch],
  );

  return (
    <View style={{ width, height }}>
      <GestureDetector gesture={gesture}>
        <Canvas style={{ width, height }} opaque>
          <Fill color={PAGE_BACKGROUND} />
          <Fill paint={paint} />
        </Canvas>
      </GestureDetector>
    </View>
  );
}
