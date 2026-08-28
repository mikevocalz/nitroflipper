import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

import type { PageBox, PageSource } from '../types';
import { shouldUseSpread } from '../pagination/SpreadPolicy';
import { PAGE_CURL_SKSL } from './pageCurlShader';

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
  const [currentImage, setCurrentImage] = useState<SkImage | null>(null);
  const [nextImage, setNextImage] = useState<SkImage | null>(null);
  const [leftImage, setLeftImage] = useState<SkImage | null>(null);

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

  // Textures: the page being turned, what is under it, and the static verso.
  useEffect(() => {
    let cancelled = false;
    const read = async (index: number) =>
      index >= 0 && index < source.pageCount
        ? makeImageFromBytes(await source.readEntryBytes(index))
        : null;

    (async () => {
      // Sequential, not Promise.all: a comic page decodes to ~24MB of RGBA
      // and decoding several at once can fail the allocation silently.
      const front = await read(leafIndex);
      if (cancelled) return;
      const under = await read(leafIndex + 1);
      if (cancelled) return;
      const left = spread ? await read(pageIndex) : null;
      if (cancelled) return;
      setCurrentImage(front);
      setNextImage(under ?? front);
      setLeftImage(left);
    })();
    return () => {
      cancelled = true;
    };
  }, [source, pageIndex, leafIndex, spread]);

  const uniforms = useDerivedValue(() => ({
    progress: progress.value,
    resolution: [leafFit.w, leafFit.h],
  }));

  // Drag maps travel across the leaf to curl progress; release either falls
  // open or springs back. All of it stays on the UI thread.
  const pan = Gesture.Pan()
    .onUpdate((event) => {
      'worklet';
      if (!canAdvance) return;
      const travel = rtl ? event.translationX : -event.translationX;
      progress.value = Math.min(Math.max(travel / leafFit.w, 0), 1);
    })
    .onEnd((event) => {
      'worklet';
      if (!canAdvance) return;
      const away = rtl ? event.velocityX : -event.velocityX;
      const flicked = Math.abs(away) > FLICK_VELOCITY;
      const commit = flicked ? away > 0 : progress.value > COMMIT_AT;

      if (commit) {
        progress.value = withTiming(1, { duration: 260 }, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(commitTurn);
        });
      } else {
        progress.value = withSpring(0, { damping: 20, stiffness: 180 });
      }
    });

  const pageRect = { x: 0, y: 0, width: leafFit.w, height: leafFit.h };

  return (
    <View style={{ width, height }}>
      <GestureDetector gesture={pan}>
        <Canvas style={{ width, height }}>
          {/* Static verso page — the half that never turns. */}
          {spread && leftImage && (
            <Group transform={[{ translateX: leftTx }, { translateY: leftTy }]}>
              <Image
                image={leftImage}
                x={0}
                y={0}
                width={leftFit.w}
                height={leftFit.h}
                fit="fill"
              />
            </Group>
          )}
          {/* The turning leaf. Local space is the page rect, so the shader's
              xy and `resolution` agree. */}
          <Group
            transform={[{ translateX: leafTx }, { translateY: leafTy }]}
            clip={pageRect}
          >
            {/* Rect, not Fill: Fill would run the curl maths over the whole
                canvas, and the page is well under half of it. */}
            {effect && currentImage && nextImage ? (
              <Rect {...pageRect}>
                <Shader source={effect} uniforms={uniforms}>
                  <ImageShader
                    image={currentImage}
                    fit="fill"
                    rect={pageRect}
                    tx="clamp"
                    ty="clamp"
                  />
                  <ImageShader
                    image={nextImage}
                    fit="fill"
                    rect={pageRect}
                    tx="clamp"
                    ty="clamp"
                  />
                </Shader>
              </Rect>
            ) : (
              currentImage && (
                <Image
                  image={currentImage}
                  x={0}
                  y={0}
                  width={leafFit.w}
                  height={leafFit.h}
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
