import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutRectangle, View } from 'react-native';
import {
  Canvas,
  Group,
  Image,
  ImageShader,
  Vertices,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  NitroModules,
  type BoxedHybridObject,
} from 'react-native-nitro-modules';

import type { PageCurlSolver } from '../../nitro/PageCurlSolver.nitro';
import type { PageBox, PageSource } from '../types';
import { shouldUseSpread } from '../pagination/SpreadPolicy';

interface PageCurlViewProps {
  source: PageSource;
  pageIndex: number;
  onPageIndexChange?: (index: number) => void;
  width: number;
  height: number;
  meshCols?: number;
  meshRows?: number;
  /**
   * Two pages side by side, curl on the outer leaf. Defaults to the
   * width test in SpreadPolicy (two page-widths fit the viewport).
   */
  spread?: boolean;
  /**
   * Width of the physical gap between display halves (Surface Duo hinge).
   * Each page is centered in its own half, so nothing lands under it.
   */
  gutter?: number;
}

// ponytail: full-resolution decode. Downscaling to the slot via
// Skia.Surface.MakeOffscreen renders blank on Android (the snapshot doesn't
// survive to the render thread) — do it at decode time if this becomes the
// bottleneck again.
function makeImageFromBytes(bytes: ArrayBuffer) {
  const data = Skia.Data.fromBytes(new Uint8Array(bytes));
  return Skia.Image.MakeImageFromEncoded(data);
}

/** Skia's SkPoint is readonly; we mutate our own buffers in place. */
type MutablePoint = { x: number; y: number };

const EMPTY_POINTS: MutablePoint[] = [];

/**
 * Write the frame's positions into `verts`. The array and its point objects
 * are reused across frames — the whole point is to allocate nothing on the
 * animation path.
 */
/**
 * Texture coords are fixed for the life of the mesh: the solver's UVs never
 * change, only the positions do. Computed once per solver.
 *
 * Skia samples them in the ImageShader's drawing space, not normalized
 * [0,1], so they are scaled to the page rect.
 */
export function PageCurlView({
  source,
  pageIndex,
  onPageIndexChange,
  width,
  height,
  // 16x16 is visually identical to a denser grid for a cone deformation and
  // costs ~2.5x fewer vertices to rebuild per frame.
  meshCols = 16,
  meshRows = 16,
  spread: spreadProp,
  gutter = 0,
}: PageCurlViewProps) {
  const solverRef = useRef<PageCurlSolver | null>(null);
  const layoutRef = useRef<LayoutRectangle>({ x: 0, y: 0, width, height });

  const [currentImage, setCurrentImage] = useState<SkImage | null>(null);
  const [nextImage, setNextImage] = useState<SkImage | null>(null);
  const [leftImage, setLeftImage] = useState<SkImage | null>(null);
  // The mesh lives in shared values, not React state: Skia reads them on the
  // UI thread, so a curl frame costs no React render and no reconciliation.
  // One deformed point array shared by both faces; the UVs differ (the back
  // is mirrored) and the triangle lists are re-split by facing every frame.
  const meshVerts = useSharedValue<MutablePoint[]>(EMPTY_POINTS);
  const frontTex = useSharedValue<MutablePoint[]>(EMPTY_POINTS);
  const backTex = useSharedValue<MutablePoint[]>(EMPTY_POINTS);
  const meshTriangles = useSharedValue<number[]>([]);
  const frontIndices = useSharedValue<number[]>([]);
  const backIndices = useSharedValue<number[]>([]);
  const [hasMesh, setHasMesh] = useState(false);
  // Everything the frame loop touches lives in shared values, so the loop
  // itself can run entirely on the UI thread.
  const grabbing = useSharedValue(false);
  // Gates the always-on frame callback; setActive() can't be called from
  // inside a worklet without freezing the callback object.
  const animating = useSharedValue(false);
  const boxedSolver = useSharedValue<BoxedHybridObject<PageCurlSolver> | null>(
    null,
  );

  const viewport = { width, height };
  const fitsTwoUp = (b: PageBox) => shouldUseSpread(viewport, b, 'auto');

  const leftBox = source.getPageBox(pageIndex);
  const nextBox =
    pageIndex + 1 < source.pageCount
      ? source.getPageBox(pageIndex + 1)
      : null;

  // Pair two pages only when both can sit two-up. A double-width page (a
  // drawn spread) can't, so it is shown alone across the whole viewport
  // rather than squeezed into half of it.
  const canSpread =
    fitsTwoUp(leftBox) && nextBox !== null && fitsTwoUp(nextBox);
  const spread = (spreadProp ?? true) && canSpread;
  // The curling leaf is the right-hand page; the left page and the page
  // under the leaf are static. Turning a leaf advances by two.
  const step = spread ? 2 : 1;
  const leafIndex = spread ? pageIndex + 1 : pageIndex;
  const box = spread && nextBox ? nextBox : leftBox;

  // A normal page shown alone (its partner is a drawn spread) still belongs
  // in one display half — centering it would straddle the fold. A genuine
  // double-width page is the one thing that may span both halves.
  const soloInHalf = !spread && fitsTwoUp(box);
  const rtl = source.progressionDirection === 'rtl';

  // Each page owns half the viewport minus the hinge gap, and is centered in
  // that half so no content sits in the physical fold.
  const halfWidth = spread || soloInHalf ? (width - gutter) / 2 : width;
  const fit = (b: PageBox) => {
    const s = Math.min(halfWidth / b.width, height / b.height);
    return { scale: s, w: b.width * s, h: b.height * s };
  };
  const leftFit = fit(leftBox);
  const leafFit = fit(box);
  const scale = leafFit.scale;
  const ty = (height - leafFit.h) / 2;
  const leftTy = (height - leftFit.h) / 2;

  // Pages butt against the spine so they meet in the middle like a bound
  // book; on a dual-screen the fold itself becomes the gutter.
  const spineX = width / 2;
  const leftTx = spineX - gutter / 2 - leftFit.w;
  const rightTx = spineX + gutter / 2;
  // Origin of the curling leaf, in view coordinates.
  const leafTx = spread
    ? rightTx
    : soloInHalf
      ? // Leading half for the reading direction, held to the spine.
        (rtl ? rightTx : leftTx)
      : (width - leafFit.w) / 2;


  // Create a solver for this page size.
  useEffect(() => {
    const solver = NitroModules.createHybridObject<PageCurlSolver>('PageCurlSolver');
    solverRef.current = solver;

    solver.init(box.width, box.height, {
      mode: 'single',
      spineAxis: 'vertical',
      // Solver book space puts the page at u ∈ [0, width]: spine (u=0) on the
      // left, active grab edge chosen by `rtl`. See PageCurlSolver.test.cpp.
      spinePosition: 0,
      grabbed: 'recto',
      rtl: source.progressionDirection === 'rtl',
      meshCols,
      meshRows,
    });

    // Fresh flat frame for the new page — otherwise the previous page's
    // fully-curled mesh lingers until the next grab.
    const flat = solver.tick(0);
    const positions = new Float32Array(flat.positions);
    const uvs = new Float32Array(flat.uvs);
    const allIndices = new Uint16Array(flat.indices);
    // Front and back copies share positions, so one point array serves both.
    const count = positions.length >> 2;

    const verts = new Array<MutablePoint>(count);
    const fTex = new Array<MutablePoint>(count);
    const bTex = new Array<MutablePoint>(count);
    for (let i = 0; i < count; i += 1) {
      verts[i] = { x: positions[i * 2], y: positions[i * 2 + 1] };
      // Skia samples texture coords in the shader's drawing space, not
      // normalized [0,1]. The back copy carries the mirrored UVs.
      fTex[i] = {
        x: uvs[i * 2] * box.width,
        y: uvs[i * 2 + 1] * box.height,
      };
      const b = (i + count) * 2;
      bTex[i] = { x: uvs[b] * box.width, y: uvs[b + 1] * box.height };
    }

    // Only the front half of the index buffer is kept: the back half is the
    // same triangles with reversed winding, and facing is decided per frame.
    const tris = Array.from(
      allIndices.subarray(
        flat.frontRangeStart,
        flat.frontRangeStart + flat.frontRangeCount,
      ),
    );

    meshVerts.value = verts;
    frontTex.value = fTex;
    backTex.value = bTex;
    meshTriangles.value = tris;
    frontIndices.value = tris;
    backIndices.value = [];
    boxedSolver.value = NitroModules.box(solver);
    setHasMesh(true);

    return () => {
      solverRef.current = null;
    };
  }, [source, pageIndex, box.width, box.height, meshCols, meshRows]);

  // Textures: the leaf's front face, the page revealed as it turns (its back
  // in single mode, the next recto in spread), and the static left page.
  useEffect(() => {
    let cancelled = false;
    const read = async (index: number) =>
      index >= 0 && index < source.pageCount
        ? makeImageFromBytes(await source.readEntryBytes(index))
        : null;

    (async () => {
      // Sequential, not Promise.all: a comic page decodes to ~24MB of RGBA,
      // and decoding three at once can fail the allocation silently.
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

  const canAdvance = pageIndex + step < source.pageCount;
  const commitTurn = useCallback(() => {
    onPageIndexChange?.(pageIndex + step);
  }, [onPageIndexChange, pageIndex, step]);

  // The animation loop runs on the UI thread: it ticks the solver through its
  // boxed handle, writes the mesh into shared values in the same runtime, and
  // never serializes a frame across the JS bridge.
  useFrameCallback((info) => {
    'worklet';
    if (!animating.value) return;
    const boxed = boxedSolver.value;
    if (boxed == null) return;
    const solver = boxed.unbox();

    const dt = Math.min(info.timeSincePreviousFrame ?? 0, 50) / 1000;
    const frame = solver.tick(dt);

    const positions = new Float32Array(frame.positions);
    const tris = meshTriangles.value;
    // Front and back copies of every vertex share a position; only the UVs
    // differ, so one deformed point array feeds both faces.
    const count = positions.length >> 2;

    const verts = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const p = i * 2;
      verts[i] = { x: positions[p], y: positions[p + 1] };
    }

    // Split the mesh by facing. Skia has no depth buffer, so without this the
    // triangles that have folded over still paint in index order and slice
    // through the art. A triangle whose winding has flipped is showing the
    // sheet's reverse, and the folded flap lies ON TOP of the flat page, so
    // it is drawn after.
    const frontTris: number[] = [];
    const backTris: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t];
      const b = tris[t + 1];
      const c = tris[t + 2];
      const ax = positions[a * 2];
      const ay = positions[a * 2 + 1];
      const area =
        (positions[b * 2] - ax) * (positions[c * 2 + 1] - ay) -
        (positions[c * 2] - ax) * (positions[b * 2 + 1] - ay);
      if (area >= 0) {
        frontTris.push(a, b, c);
      } else {
        backTris.push(a, b, c);
      }
    }

    meshVerts.value = verts;
    frontIndices.value = frontTris;
    backIndices.value = backTris;

    // Once the finger is up, stop when the spring settles; committing a page
    // is the only hop back to JS, and it happens once per turn.
    if (!grabbing.value) {
      if (frame.progress >= 0.999) {
        animating.value = false;
        if (canAdvance) scheduleOnRN(commitTurn);
      } else if (frame.progress <= 0.001) {
        animating.value = false;
      }
    }
  }, true);

  // Gesture handlers are worklets: they drive the solver on the UI thread
  // through its boxed handle, so a drag never touches the JS thread.
  const pan = Gesture.Pan()
    .onBegin((event) => {
      'worklet';
      const boxed = boxedSolver.value;
      if (boxed == null) return;
      // Nothing to turn to: refuse the grab rather than leave the leaf
      // stranded mid-curl when the commit is later declined.
      if (!canAdvance) return;
      const x = (event.x - leafTx) / scale;
      const y = (event.y - ty) / scale;
      if (boxed.unbox().beginGrab(x, y)) {
        grabbing.value = true;
        animating.value = true;
      }
    })
    .onUpdate((event) => {
      'worklet';
      const boxed = boxedSolver.value;
      if (boxed == null || !grabbing.value) return;
      const x = (event.x - leafTx) / scale;
      const y = (event.y - ty) / scale;
      boxed.unbox().updateGrab(x, y);
    })
    .onEnd((event) => {
      'worklet';
      const boxed = boxedSolver.value;
      if (boxed == null || !grabbing.value) return;
      grabbing.value = false;
      boxed.unbox().release(event.velocityX, event.velocityY);
    });

  return (
    <View style={{ width, height }} onLayout={(e) => (layoutRef.current = e.nativeEvent.layout)}>
      <GestureDetector gesture={pan}>
        <Canvas style={{ width, height }}>
          {/* Static verso page — the half that never turns. */}
          {spread && leftImage && (
            <Group
              transform={[
                { translateX: leftTx },
                { translateY: leftTy },
                { scale },
              ]}
            >
              <Image
                image={leftImage}
                x={0}
                y={0}
                width={leftBox.width}
                height={leftBox.height}
                fit="fill"
              />
            </Group>
          )}
          <Group
            transform={[
              { translateX: leafTx },
              { translateY: ty },
              { scale },
            ]}
          >
            {/* Static next page */}
            {nextImage && (
              <Image
                image={nextImage}
                x={0}
                y={0}
                width={box.width}
                height={box.height}
                fit="fill"
              />
            )}
            {/* The flat page. Triangles that have folded over are excluded
                here and drawn as the flap below, so nothing z-fights. */}
            {hasMesh && currentImage && (
              <Group>
                <ImageShader
                  image={currentImage}
                  tx="clamp"
                  ty="clamp"
                  fit="fill"
                  rect={{ x: 0, y: 0, width: box.width, height: box.height }}
                />
                <Vertices
                  mode="triangles"
                  vertices={meshVerts}
                  textures={frontTex}
                  indices={frontIndices}
                />
              </Group>
            )}
            {/* The folded-over flap: the reverse of the same sheet, lying on
                top of the page it just lifted off. */}
            {hasMesh && nextImage && (
              <Group>
                <ImageShader
                  image={nextImage}
                  tx="clamp"
                  ty="clamp"
                  fit="fill"
                  rect={{ x: 0, y: 0, width: box.width, height: box.height }}
                />
                <Vertices
                  mode="triangles"
                  vertices={meshVerts}
                  textures={backTex}
                  indices={backIndices}
                />
              </Group>
            )}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}
