import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
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
  const soloInHalf = !spread && fitsTwoUp(box);
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

  const canAdvance = pageIndex + step < source.pageCount;

  const commitTurn = useCallback(() => {
    onPageIndexChange?.(pageIndex + step);
  }, [onPageIndexChange, pageIndex, step]);

  // A new spread starts flat.
  useEffect(() => {
    progress.value = 0;
  }, [pageIndex, progress]);

  // Four half-pages: the spread you are on and the one you are turning to.
  // The turning sheet spans both halves so the curl crosses the spine.
  // Per-instance vanilla store — two readers on one screen keep their own
  // pages, and no component state lives in React.
  const storeRef = useRef<PageStore | null>(null);
  if (storeRef.current == null) storeRef.current = createPageStore();
  const pages = useStore(storeRef.current, (s) => s.pages);
  const setPages = storeRef.current.getState().setPages;

  useEffect(() => {
    let cancelled = false;
    const read = async (index: number) =>
      index >= 0 && index < source.pageCount
        ? makeImageFromBytes(await source.readEntryBytes(index))
        : null;

    (async () => {
      // Sequential, not Promise.all: a comic page decodes to ~24MB of RGBA
      // and decoding several at once can fail the allocation silently.
      const fromLeft = spread ? await read(pageIndex) : null;
      if (cancelled) return;
      const fromRight = await read(leafIndex);
      if (cancelled) return;
      const toLeft = spread ? await read(pageIndex + step) : null;
      if (cancelled) return;
      const toRight = await read(leafIndex + step);
      if (cancelled) return;
      setPages({ fromLeft, fromRight, toLeft, toRight });
    })();
    return () => {
      cancelled = true;
    };
  }, [source, pageIndex, leafIndex, spread, step]);

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

  const uniforms = useDerivedValue(() => ({
    progress: progress.value,
    resolution: [sheetW, sheetH],
    halfW,
    dir: dir.value,
  }));

  // Drag maps travel across the leaf to curl progress; release either falls
  // open or springs back. All of it stays on the UI thread.
  const canGoBack = pageIndex - step >= 0;
  const goBack = useCallback(() => {
    onPageIndexChange?.(pageIndex - step);
  }, [onPageIndexChange, pageIndex, step]);

  // Books turn both ways: dragging in from the outer edge turns forward,
  // dragging out from the spine side pulls the previous leaf back.
  const pan = Gesture.Pan()
    .onBegin((event) => {
      'worklet';
      const forward = rtl
        ? event.x < sheetX + sheetW / 2
        : event.x > sheetX + sheetW / 2;
      dir.value = forward ? 1 : -1;
      progress.value = 0;
    })
    .onUpdate((event) => {
      'worklet';
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
        progress.value = withTiming(1, { duration: 280 }, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(forward ? commitTurn : goBack);
        });
      } else {
        progress.value = withSpring(0, { damping: 20, stiffness: 180 });
      }
    });

  const half = (img: SkImage | null, rect: typeof leftRect) =>
    img ? (
      <ImageShader image={img} fit="fill" rect={rect} tx="clamp" ty="clamp" />
    ) : (
      // A missing half (the outer edge of the book) reads as blank stock.
      <ImageShader
        image={pages.fromRight ?? img!}
        fit="fill"
        rect={{ ...rect, width: 0, height: 0 }}
        tx="clamp"
        ty="clamp"
      />
    );

  const ready = effect && pages.fromRight;

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
