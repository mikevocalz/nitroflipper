import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { PixelRatio, View } from 'react-native';
import {
  Canvas,
  Group,
  Image,
  ImageShader,
  Rect,
  Shader,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useStore } from 'zustand';

import type { PageBox, PageSource } from '../types';
import { shouldUseSpread } from '../pagination/SpreadPolicy';
import { PAGE_CURL_SKSL } from './pageCurlShader';
import { createPageStore, type PageStore } from './pageStore';
import {
  PageTextureCache,
  textureBytes,
  type PageKey,
} from './PageTextureCache';
import { buildSpreadGroups, planSpreadAt } from './spreadPlan';

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
   * previous book's page 7 for the new book's page 7. Defaults to a per-view
   * constant, which is correct while a view shows one document for its life.
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
   * Called when the pages on screen change, with the page indices now drawn.
   *
   * Not the same moment as `onPageIndexChange`, which fires the instant a turn
   * commits. The canvas is a SurfaceView and composites independently of the
   * React view hierarchy, so chrome driven by the requested index updates a
   * frame before the page it is labelling -- the page counter ticks over while
   * the old page is still on screen. Label the reader from this instead.
   */
  onSpreadVisible?: (pages: readonly number[]) => void;
  /**
   * Called when a page fails to load.
   *
   * Without this a rejection inside the loader is an unhandled promise and the
   * reader just stays blank -- no page, no error, nothing to act on.
   */
  onPageLoadError?: (error: unknown) => void;
}

/** The pages a group covers, in reading order. */
function pagesOfGroup(group: { start: number; size: number }): number[] {
  return Array.from({ length: group.size }, (_, i) => group.start + i);
}

/** Generations to key the cache on, when the source publishes them. */
function sourceGenerations(source: PageSource): {
  document: number;
  layout: number;
} {
  // MuPDFSource publishes these; ComicArchiveSource does not, and a CBZ has
  // neither a relayout nor a reopen that changes its pages, so zeros are
  // correct rather than a placeholder.
  const withGenerations = source as PageSource & {
    generations?: { document: number; layout: number };
  };
  return withGenerations.generations ?? { document: 0, layout: 0 };
}

function makeImageFromBytes(bytes: ArrayBuffer) {
  const data = Skia.Data.fromBytes(new Uint8Array(bytes));
  return Skia.Image.MakeImageFromEncoded(data);
}

/** Resolve after `count` drawn frames, so a UI-thread write can follow a mount. */
function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

/** A flick this fast decides the turn regardless of how far it got. */
const FLICK_VELOCITY = 400;
/** Past this fraction of the page, a released drag falls open. */
const COMMIT_AT = 0.5;
/**
 * Ceiling on the speed a release hands the animation, in pages per second.
 *
 * Carrying the finger's speed keeps the motion continuous, but a hard flick
 * measures thousands of pixels a second: the spring then covers what is left
 * of the page inside a single frame and the turn reads as a snap rather than a
 * page falling. A page still turns in about a third of a second at this
 * ceiling, which is roughly what paper does.
 */
const MAX_RELEASE_SPEED = 3;

export function PageCurlView({
  source,
  pageIndex,
  onPageIndexChange,
  width,
  height,
  spread: spreadProp,
  gutter = 0,
  onLayoutChange,
  turnRequest,
  documentId = 'default',
  appearance = 'default',
  textureBudgetBytes,
  onSpreadVisible,
  onPageLoadError,
}: PageCurlViewProps) {
  // The whole animation is one scalar on the UI thread. The curl itself is
  // evaluated per pixel by the shader, so a frame costs no JS at all.
  const progress = useSharedValue(0);

  const effect = useMemo(() => Skia.RuntimeEffect.Make(PAGE_CURL_SKSL), []);

  const viewport = { width, height };
  const fitsTwoUp = (b: PageBox) => shouldUseSpread(viewport, b, 'auto');
  const generations = sourceGenerations(source);

  // Pair two pages only when both can sit two-up. A double-width page (a
  // drawn spread) is shown alone across the viewport instead of squeezed
  // into half of it.
  //
  // Grouped for the whole book, not for the page you are on: after a page
  // shown alone the pairing parity flips, so a back-turn that subtracts the
  // current group's size lands between two groups and the way back stops
  // matching the way out. See spreadPlan.ts.
  const groups = useMemo(
    () =>
      buildSpreadGroups(
        source.pageCount,
        (index) => fitsTwoUp(source.getPageBox(index)),
        spreadProp ?? true,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, source.pageCount, width, height, gutter, spreadProp,
     generations.document, generations.layout],
  );
  const plan = planSpreadAt(groups, pageIndex);
  const spread = plan.spread;
  const step = plan.step;
  const leafIndex = plan.leafIndex;
  const leftBox = source.getPageBox(plan.pages[0]);
  const box = source.getPageBox(leafIndex);

  // A normal page shown alone still belongs in one display half — centering
  // it would straddle a fold. A true double-width page may span both.
  // A page shown alone gets the whole viewport. Confining it to one half
  // leaves the other half dead black, which reads as a broken render.
  const soloInHalf = false;
  const rtl = source.progressionDirection === 'rtl';

  const halfWidth = spread || soloInHalf ? (width - gutter) / 2 : width;
  const fit = (b: PageBox) => {
    const s = Math.min(halfWidth / b.width, height / b.height);
    return { w: b.width * s, h: b.height * s };
  };
  const leftFit = fit(leftBox);
  const leafFit = fit(box);

  // Pages butt against the spine so they meet like a bound book; on a
  // dual-screen the fold itself becomes the gutter.
  const spineX = width / 2;
  const leftTx = spineX - gutter / 2 - leftFit.w;
  const rightTx = spineX + gutter / 2;
  const leafTx = spread
    ? rightTx
    : soloInHalf
      ? rtl
        ? rightTx
        : leftTx
      : (width - leafFit.w) / 2;
  const leafTy = (height - leafFit.h) / 2;
  const leftTy = (height - leftFit.h) / 2;

  // A page control turns the page through the same curl a flick does, so the
  // two read as one interaction — and the animation covers any decode.
  const requestId = turnRequest?.id ?? 0;
  const requestDir = turnRequest?.dir ?? 1;
  useEffect(() => {
    if (requestId === 0 || turning.value) return;
    const forward = requestDir > 0;
    if (forward ? !canAdvance : !canGoBack) return;
    dir.value = forward ? 1 : -1;
    progress.value = 0;
    turning.value = true;
    progress.value = withTiming(1, { duration: 320 }, (finished) => {
      'worklet';
      if (finished) scheduleOnRN(commitDirection, forward);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  useEffect(() => {
    onLayoutChange?.({ step, spread });
  }, [onLayoutChange, step, spread]);

  const canAdvance = plan.next !== null;

  // Four half-pages: the spread you are on and the one you are turning to.
  // The turning sheet spans both halves so the curl crosses the spine.
  // Per-instance vanilla store — two readers on one screen keep their own
  // pages, and no component state lives in React.
  const storeRef = useRef<PageStore | null>(null);
  if (storeRef.current == null) storeRef.current = createPageStore();
  const pages = useStore(storeRef.current, (s) => s.pages);
  const setPages = storeRef.current.getState().setPages;

  // Decoded pages are reused across turns: the spread you turn *to* becomes
  // the spread you turn *from*, so re-decoding it costs megabytes for nothing.
  //
  // Keyed on full identity, not page index. Index alone collides across
  // relayouts, viewport changes and document swaps -- see
  // docs/adr/0003-cache-identity-and-budget.md.
  const cacheRef = useRef<PageTextureCache | null>(null);
  // What the frame currently on screen is holding, so it can be released only
  // once its replacement is up. Dispose-on-load is what could pull a texture
  // out from under the shader mid-curl.
  const retainedRef = useRef<PageKey[]>([]);
  // Which way the reader is moving, so the warm-up follows them rather than
  // always running forward. 1 on first open: a book opens going forward.
  const travelRef = useRef(1);

  const scale = PixelRatio.get();
  /**
   * The raster a page is decoded at, from that page's own slot.
   *
   * Not from the spread you happen to be on: a double-width page is shown
   * alone across the whole viewport, so while one is on screen every
   * neighbour was being decoded at full-viewport size -- 24MB a page instead
   * of 8MB -- and then decoded all over again at half size on the next turn,
   * because the raster is part of the cache key. Three of those pages sit
   * together near the end of a typical comic, which is where the reader ran
   * out of memory and drew nothing.
   */
  const rasterOf = (index: number) => {
    const group = planSpreadAt(groups, index);
    const slotWidth = group.spread ? (width - gutter) / 2 : width;
    const b = source.getPageBox(index);
    const s = Math.min(slotWidth / b.width, height / b.height);
    return {
      w: Math.ceil(b.width * s * scale),
      h: Math.ceil(b.height * s * scale),
    };
  };

  // Budget the pages actually in flight, at the size each is actually decoded
  // at: the spread you are on, the one ahead, the one behind, and the warm-up
  // beyond. A budget below the working set evicts a page the current frame is
  // about to draw and re-decodes it on the next swipe -- the reader flickers
  // and pages come back blank while turning back and forth. Half again over
  // the measured need is the headroom.
  const inFlight = [
    ...plan.pages,
    ...(plan.next ? pagesOfGroup(plan.next) : []),
    ...(plan.previous ? pagesOfGroup(plan.previous) : []),
  ];
  const budgetBytes =
    textureBudgetBytes ??
    Math.max(
      Math.ceil(
        1.5 *
          inFlight.reduce((total, index) => {
            const r = rasterOf(index);
            return total + textureBytes(r.w, r.h);
          }, 0),
      ),
      32 * 1024 * 1024,
    );

  if (cacheRef.current === null) {
    cacheRef.current = new PageTextureCache({ budgetBytes });
  }
  // The raster size changes with the viewport, so the budget has to follow it.
  cacheRef.current.setBudget(budgetBytes);

  useEffect(() => {
    let cancelled = false;
    const cache = cacheRef.current;
    if (cache === null) return;

    const keyFor = (index: number, raster: { w: number; h: number }): PageKey => ({
      documentId,
      documentGeneration: generations.document,
      layoutGeneration: generations.layout,
      pageIndex: index,
      renderWidth: raster.w,
      renderHeight: raster.h,
      rotation: 0,
      appearance,
    });

    // A relayout or a new document invalidates everything that came before,
    // so a late loader cannot repopulate a retired cache.
    cache.invalidateExcept(documentId, generations.document, generations.layout);

    // Retained the moment it exists, not after every read has finished.
    // peek() does not retain, so a later set() in the same pass could evict
    // an image this pass was still holding -- and a disposed SkImage draws
    // nothing.
    const runRetained: PageKey[] = [];
    const read = async (index: number | null): Promise<SkImage | null> => {
      if (index === null || index < 0 || index >= source.pageCount) return null;
      const raster = rasterOf(index);
      const key = keyFor(index, raster);

      const hit = cache.peek(key);
      if (hit !== null) {
        if (cache.retain(key) !== null) runRetained.push(key);
        return hit;
      }

      const bytes = await source.readPageScaled(index, raster.w, raster.h);
      if (cancelled) return null;
      const image = makeImageFromBytes(bytes);
      if (image === null) return null;
      const stored = cache.set(key, image, textureBytes(raster.w, raster.h));
      if (cache.retain(key) !== null) runRetained.push(key);
      return stored;
    };

    /** Hand back everything a pass retained but the frame does not hold. */
    const releaseRun = (keys: PageKey[]) => {
      for (const key of keys) cache.release(key);
      keys.length = 0;
    };

    /**
     * The visible pair becomes the frame; the previous frame lets go.
     *
     * Retain-then-release, never the reverse: releasing first can drop the
     * last reference to an image the shader is sampling this very frame.
     */
    const replaceFrameRetains = () => {
      const previous = retainedRef.current;
      retainedRef.current = [...runRetained];
      runRetained.length = 0;
      for (const key of previous) cache.release(key);
    };

    /**
     * The neighbours join the frame.
     *
     * Appended, not swapped in: the visible pair is still on screen and must
     * keep its retains, or the next eviction disposes the page being drawn.
     */
    const addFrameRetains = () => {
      retainedRef.current = [...retainedRef.current, ...runRetained];
      runRetained.length = 0;
    };

    const here = planSpreadAt(groups, pageIndex);
    /** Left and right slot for a group: a solo page occupies the right slot. */
    const slotsOf = (group: { start: number; size: number } | null) =>
      group === null
        ? { left: null, right: null }
        : {
            left: group.size === 2 ? group.start : null,
            right: group.start + group.size - 1,
          };
    const from = slotsOf({ start: here.pages[0], size: here.step });
    const to = slotsOf(here.next);
    const prev = slotsOf(here.previous);

    (async () => {
      // Sequential, not Promise.all: a page decodes to megabytes of RGBA and
      // several at once can fail the allocation silently.
      //
      // Two passes, because the reader is waiting on the first one. The pages
      // you can SEE are published as soon as they exist -- that publish is
      // what clears the turn guard -- and the neighbours the curl will need
      // are filled in behind it. Loading all six before publishing anything
      // is what made a back-turn sit on a frozen curl: the spread behind the
      // one you just landed on had never been prefetched, so every back-turn
      // waited on two fresh decodes before the reader came back to life.
      const fromLeft = await read(from.left);
      const fromRight = await read(from.right);
      if (cancelled) {
        releaseRun(runRetained);
        return;
      }
      replaceFrameRetains();
      setPages({
        fromLeft,
        fromRight,
        toLeft: null,
        toRight: null,
        prevLeft: null,
        prevRight: null,
      });

      // Laying the sheet flat is a write to the UI thread and lands at once;
      // mounting the new textures goes through a React commit and lands a
      // frame or two later. Reset progress first and the canvas draws the
      // PREVIOUS page flat in between -- the page you just turned away from
      // flashing back before the new one appears. Wait for the frames that
      // carry the mount, then lay it flat.
      //
      // The destination halves stay unpublished until after that, so a curl
      // sitting at full progress can only be showing the page that is about
      // to become the flat one.
      await nextFrames(2);
      if (cancelled) return;
      progress.value = 0;
      turning.value = false;
      onSpreadVisible?.(here.pages);

      const toLeft = await read(to.left);
      const toRight = await read(to.right);
      const prevLeft = await read(prev.left);
      const prevRight = await read(prev.right);
      if (cancelled) {
        releaseRun(runRetained);
        return;
      }
      addFrameRetains();
      setPages({ fromLeft, fromRight, toLeft, toRight, prevLeft, prevRight });

      // Warm the spread beyond the one you are heading for, in the direction
      // you are actually travelling. Prefetching forward while the reader
      // pages backward warms pages they are walking away from and leaves the
      // ones they are walking into cold.
      const ahead =
        travelRef.current >= 0
          ? here.next && planSpreadAt(groups, here.next.start).next
          : here.previous && planSpreadAt(groups, here.previous.start).previous;
      const warm = slotsOf(ahead ?? null);
      // A warm-up is not a frame dependency: release its retains as soon as
      // it lands so it can be evicted under pressure.
      const warmed: PageKey[] = [];
      const takeWarm = () => {
        warmed.push(...runRetained);
        runRetained.length = 0;
      };
      if (!cancelled) {
        await read(warm.left);
        takeWarm();
      }
      if (!cancelled) {
        await read(warm.right);
        takeWarm();
      }
      releaseRun(warmed);
    })().catch((error) => {
      releaseRun(runRetained);
      if (cancelled) return;
      // Release the turn guard, or a failed load locks the reader on a page
      // it never managed to draw.
      turning.value = false;
      onPageLoadError?.(error);
    });
    return () => {
      cancelled = true;
    };
    // width/height/gutter are in the list on purpose: the raster follows the
    // viewport and the pixel density, and leaving them out is why rotating the
    // device used to leave correctly laid out pages at the old raster size.
  }, [
    source, documentId, pageIndex, groups,
    width, height, gutter, scale, appearance,
    generations.document, generations.layout,
  ]);

  // Release the frame's textures when the reader goes away, or they outlive it.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      if (cache === null) return;
      for (const key of retainedRef.current) cache.release(key);
      retainedRef.current = [];
      cache.clear();
    };
  }, []);

  // The sheet covers both halves; each image sits in its own half.
  const sheetW = spread ? leftFit.w + gutter + leafFit.w : leafFit.w;
  const sheetH = Math.max(leftFit.h, leafFit.h);
  const sheetX = spread ? leftTx : leafTx;
  const sheetY = spread ? Math.min(leftTy, leafTy) : leafTy;
  const halfW = spread ? leftFit.w + gutter / 2 : leafFit.w;
  const leftRect = { x: 0, y: leftTy - sheetY, width: leftFit.w, height: leftFit.h };
  const rightRect = {
    x: sheetW - leafFit.w,
    y: leafTy - sheetY,
    width: leafFit.w,
    height: leafFit.h,
  };
  const sheetRect = { x: 0, y: 0, width: sheetW, height: sheetH };

  // How far the finger must travel to turn the leaf all the way over.
  const leafWidth = leafFit.w;

  // -1 while turning back, so the same curl runs mirrored about the spine.
  const dir = useSharedValue(1);
  // True from the moment a turn commits until its pages are on screen, so a
  // second swipe cannot commit again and skip a spread.
  const turning = useSharedValue(false);

  const uniforms = useDerivedValue(() => ({
    progress: progress.value,
    resolution: [sheetW, sheetH],
    halfW,
    dir: dir.value,
  }));

  // Drag maps travel across the leaf to curl progress; release either falls
  // open or springs back. All of it stays on the UI thread.
  const canGoBack = plan.previous !== null;
  // One callback the worklet can capture. Passing a *conditional* function
  // reference to scheduleOnRN leaves the gesture silently inert.
  const commitDirection = useCallback(
    (forward: boolean) => {
      travelRef.current = forward ? 1 : -1;
      const target = forward ? plan.next : plan.previous;
      const next = target?.start ?? pageIndex;
      if (next === pageIndex || next < 0 || next >= source.pageCount) {
        // Nothing will load, so release the guard here or the reader locks.
        turning.value = false;
        return;
      }
      onPageIndexChange?.(next);
    },
    [onPageIndexChange, pageIndex, plan.next, plan.previous, source.pageCount, turning],
  );

  // Books turn both ways: dragging in from the outer edge turns forward,
  // dragging out from the spine side pulls the previous leaf back.
  const pan = Gesture.Pan()
    // A tap is not a turn. Without an activation threshold the gesture begins
    // on touch-down, and the begin handler used to zero `progress` -- tapping
    // the page mid-settle snapped the curl flat.
    .activeOffsetX([-8, 8])
    .failOffsetY([-24, 24])
    .onStart((event) => {
      'worklet';
      if (turning.value) return;
      const forward = rtl
        ? event.x < sheetX + sheetW / 2
        : event.x > sheetX + sheetW / 2;
      dir.value = forward ? 1 : -1;
      progress.value = 0;
    })
    .onUpdate((event) => {
      'worklet';
      if (turning.value) return;
      const forward = dir.value > 0;
      if (forward ? !canAdvance : !canGoBack) return;
      // Forward drags travel toward the spine, back drags away from it.
      const travel = forward
        ? rtl
          ? event.translationX
          : -event.translationX
        : rtl
          ? -event.translationX
          : event.translationX;
      // Across the leaf being turned, not half the sheet. Two pages side by
      // side make those the same distance, but a single page shown alone IS
      // the sheet, and dividing it in half turned the page in half the finger
      // travel -- the curl ran away from the finger on one screen.
      progress.value = Math.min(Math.max(travel / leafWidth, 0), 1);
    })
    .onEnd((event) => {
      'worklet';
      if (turning.value) return;
      const forward = dir.value > 0;
      if (forward ? !canAdvance : !canGoBack) return;
      const away = forward
        ? rtl
          ? event.velocityX
          : -event.velocityX
        : rtl
          ? -event.velocityX
          : event.velocityX;
      const flicked = Math.abs(away) > FLICK_VELOCITY;
      const commit = flicked ? away > 0 : progress.value > COMMIT_AT;

      // Continue at the speed the finger was moving. A fixed-duration tween
      // starts from a dead stop no matter how hard the page was flicked, which
      // is the hitch between letting go and the page falling open -- and at
      // the other extreme it crawls when the page is already nearly over.
      // Velocity is in pixels/s; the curl is in progress units, where 1 is
      // half the sheet.
      const velocity = Math.min(away / leafWidth, MAX_RELEASE_SPEED);
      if (commit) {
        turning.value = true;
        // Clamped to the direction it is going. A drag dragged past the
        // halfway mark and then let go while easing back releases with the
        // velocity pointing the other way -- the page lurched backwards
        // before falling open, and the turn committed late enough that the
        // page counter ran ahead of the page.
        progress.value = withSpring(
          1,
          {
            velocity: Math.max(velocity, 0),
            damping: 26,
            stiffness: 260,
            overshootClamping: true,
          },
          (finished) => {
            'worklet';
            if (finished) scheduleOnRN(commitDirection, forward);
          },
        );
      } else {
        progress.value = withSpring(0, {
          velocity: Math.max(Math.min(velocity, 0), -MAX_RELEASE_SPEED),
          damping: 22,
          stiffness: 200,
          overshootClamping: true,
        });
      }
    });

  // Every shader slot must be a real image. A zero-sized ImageShader makes
  // the whole runtime effect draw nothing, which is why the last spread of a
  // book came out blank: past the final leaf there is no "to" spread, so two
  // of the four slots had nothing to bind.
  const half = (img: SkImage | null, rect: typeof leftRect) => (
    <ImageShader
      image={img ?? pages.fromRight!}
      fit="fill"
      rect={rect}
      tx="clamp"
      ty="clamp"
    />
  );

  // The visible halves must be genuinely loaded. The destination halves may
  // fall back to a real image because they are only seen mid-curl, but doing
  // that for a visible half draws the same page twice.
  const ready =
    effect && pages.fromRight != null && (!spread || pages.fromLeft != null);

  return (
    <View style={{ width, height }}>
      <GestureDetector gesture={pan}>
        {/*
          opaque puts the canvas on Android's SurfaceView path instead of a
          TextureView. A TextureView hands every frame back through the view
          hierarchy, so a full-screen reader pays a 2700x1800 composite on the
          UI thread per frame -- measured at 44-79ms a frame during a turn
          while the GPU itself was under 10ms, which is why the curl drew one
          intermediate frame and then snapped. A book page is fully opaque, so
          nothing is lost by saying so.
        */}
        <Canvas style={{ width, height }} opaque>
          <Group transform={[{ translateX: sheetX }, { translateY: sheetY }]}>
            {ready ? (
              <Rect {...sheetRect}>
                <Shader source={effect} uniforms={uniforms}>
                  {half(pages.fromLeft, leftRect)}
                  {half(pages.fromRight, rightRect)}
                  {half(pages.toLeft, leftRect)}
                  {half(pages.toRight, rightRect)}
                  {half(pages.prevLeft, leftRect)}
                  {half(pages.prevRight, rightRect)}
                </Shader>
              </Rect>
            ) : (
              pages.fromRight && (
                <Image
                  image={pages.fromRight}
                  x={rightRect.x}
                  y={rightRect.y}
                  width={rightRect.width}
                  height={rightRect.height}
                  fit="fill"
                />
              )
            )}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}
