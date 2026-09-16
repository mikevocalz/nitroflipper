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
   * six phone pages at 2x. Default is six 1080x1920 RGBA pages.
   */
  textureBudgetBytes?: number;
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

/** A flick this fast decides the turn regardless of how far it got. */
const FLICK_VELOCITY = 400;
/** Past this fraction of the page, a released drag falls open. */
const COMMIT_AT = 0.5;

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
  textureBudgetBytes = 6 * 1080 * 1920 * 4,
}: PageCurlViewProps) {
  // The whole animation is one scalar on the UI thread. The curl itself is
  // evaluated per pixel by the shader, so a frame costs no JS at all.
  const progress = useSharedValue(0);

  const effect = useMemo(() => Skia.RuntimeEffect.Make(PAGE_CURL_SKSL), []);

  const viewport = { width, height };
  const fitsTwoUp = (b: PageBox) => shouldUseSpread(viewport, b, 'auto');

  const leftBox = source.getPageBox(pageIndex);
  const nextBox =
    pageIndex + 1 < source.pageCount ? source.getPageBox(pageIndex + 1) : null;

  // Pair two pages only when both can sit two-up. A double-width page (a
  // drawn spread) is shown alone across the viewport instead of squeezed
  // into half of it.
  const canSpread =
    fitsTwoUp(leftBox) && nextBox !== null && fitsTwoUp(nextBox);
  const spread = (spreadProp ?? true) && canSpread;
  const step = spread ? 2 : 1;
  const leafIndex = spread ? pageIndex + 1 : pageIndex;
  const box = spread && nextBox ? nextBox : leftBox;

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

  const canAdvance = pageIndex + step < source.pageCount;

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
  if (cacheRef.current === null) {
    cacheRef.current = new PageTextureCache({ budgetBytes: textureBudgetBytes });
  }
  // What the frame currently on screen is holding, so it can be released only
  // once its replacement is up. Dispose-on-load is what could pull a texture
  // out from under the shader mid-curl.
  const retainedRef = useRef<PageKey[]>([]);

  const scale = PixelRatio.get();
  const texW = Math.ceil(leafFit.w * scale);
  const texH = Math.ceil(leafFit.h * scale);
  const generations = sourceGenerations(source);

  useEffect(() => {
    let cancelled = false;
    const cache = cacheRef.current;
    if (cache === null) return;

    const keyFor = (index: number): PageKey => ({
      documentId,
      documentGeneration: generations.document,
      layoutGeneration: generations.layout,
      pageIndex: index,
      renderWidth: texW,
      renderHeight: texH,
      rotation: 0,
      appearance,
    });

    // A relayout or a new document invalidates everything that came before,
    // so a late loader cannot repopulate a retired cache.
    cache.invalidateExcept(documentId, generations.document, generations.layout);

    const read = async (index: number): Promise<SkImage | null> => {
      if (index < 0 || index >= source.pageCount) return null;
      const key = keyFor(index);
      const hit = cache.peek(key);
      if (hit !== null) return hit;

      const bytes = await source.readPageScaled(index, texW, texH);
      if (cancelled) return null;
      const image = makeImageFromBytes(bytes);
      if (image === null) return null;
      return cache.set(key, image, textureBytes(texW, texH));
    };

    (async () => {
      // Sequential, not Promise.all: a page decodes to megabytes of RGBA and
      // several at once can fail the allocation silently.
      const wanted = spread
        ? [pageIndex, leafIndex, pageIndex + step, leafIndex + step,
           pageIndex - step, leafIndex - step]
        : [leafIndex, leafIndex + step, leafIndex - step];

      const images = new Map<number, SkImage | null>();
      for (const index of wanted) {
        if (cancelled) return;
        images.set(index, await read(index));
      }
      if (cancelled) return;

      // Retain the new set before releasing the old, so nothing the shader is
      // sampling is ever momentarily unreferenced.
      const nextRetained = wanted
        .filter((index) => images.get(index) != null)
        .map(keyFor);
      for (const key of nextRetained) cache.retain(key);
      for (const key of retainedRef.current) cache.release(key);
      retainedRef.current = nextRetained;

      setPages({
        fromLeft: spread ? images.get(pageIndex) ?? null : null,
        fromRight: images.get(leafIndex) ?? null,
        toLeft: spread ? images.get(pageIndex + step) ?? null : null,
        toRight: images.get(leafIndex + step) ?? null,
        prevLeft: spread ? images.get(pageIndex - step) ?? null : null,
        prevRight: images.get(leafIndex - step) ?? null,
      });
      turning.value = false;

      // Warm the spread after this one while the reader is looking at the
      // current pages, so a turn never waits on a decode.
      if (!cancelled) void read(leafIndex + step + 1);
      if (!cancelled) void read(leafIndex + step + 2);
    })();
    return () => {
      cancelled = true;
    };
    // texW/texH are in the list on purpose: they change with the viewport and
    // the pixel density, and leaving them out is why rotating the device used
    // to leave correctly laid out pages rendered at the old raster size.
  }, [
    source, documentId, pageIndex, leafIndex, spread, step,
    texW, texH, appearance,
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

  // -1 while turning back, so the same curl runs mirrored about the spine.
  const dir = useSharedValue(1);
  // True from the moment a turn commits until its pages are on screen, so a
  // second swipe cannot commit again and skip a spread.
  const turning = useSharedValue(false);

  // Lay the sheet flat only after React has committed the new pages. Doing
  // it in the loader resets progress on the UI thread while the OLD textures
  // are still bound, which shows the previous spread flat for a frame — the
  // blink on a turn.
  // Keyed on the VISIBLE pair, not the whole pages object. The destination
  // halves are published a moment later, and reacting to that second publish
  // reset progress in the middle of an in-flight turn — which is a jump.
  useEffect(() => {
    if (pages.fromRight == null) return;
    progress.value = 0;
    turning.value = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.fromLeft, pages.fromRight]);

  const uniforms = useDerivedValue(() => ({
    progress: progress.value,
    resolution: [sheetW, sheetH],
    halfW,
    dir: dir.value,
  }));

  // Drag maps travel across the leaf to curl progress; release either falls
  // open or springs back. All of it stays on the UI thread.
  const canGoBack = pageIndex - step >= 0;
  // One callback the worklet can capture. Passing a *conditional* function
  // reference to scheduleOnRN leaves the gesture silently inert.
  const commitDirection = useCallback(
    (forward: boolean) => {
      const next = forward ? pageIndex + step : pageIndex - step;
      if (next === pageIndex || next < 0 || next >= source.pageCount) {
        // Nothing will load, so release the guard here or the reader locks.
        turning.value = false;
        return;
      }
      onPageIndexChange?.(next);
    },
    [onPageIndexChange, pageIndex, step, source.pageCount, turning],
  );

  // Books turn both ways: dragging in from the outer edge turns forward,
  // dragging out from the spine side pulls the previous leaf back.
  const pan = Gesture.Pan()
    .onBegin((event) => {
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
      progress.value = Math.min(Math.max(travel / (sheetW / 2), 0), 1);
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

      if (commit) {
        turning.value = true;
        progress.value = withTiming(1, { duration: 280 }, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(commitDirection, forward);
        });
      } else {
        progress.value = withSpring(0, { damping: 20, stiffness: 180 });
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
        <Canvas style={{ width, height }}>
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
