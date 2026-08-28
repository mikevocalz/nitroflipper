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

import { NitroModules } from 'react-native-nitro-modules';

import type { Frame } from '../../nitro/FlipperTypes';
import type { PageCurlSolver } from '../../nitro/PageCurlSolver.nitro';
import type { PageBox, PageSource } from '../types';
import { shouldUseSpread } from '../pagination/SpreadPolicy';

const EMPTY_FRAME: Frame = {
  positions: new ArrayBuffer(0),
  uvs: new ArrayBuffer(0),
  indices: new ArrayBuffer(0),
  frontRangeStart: 0,
  frontRangeCount: 0,
  backRangeStart: 0,
  backRangeCount: 0,
  staticHalfClipX: 0,
  staticHalfClipY: 0,
  staticHalfClipWidth: 0,
  staticHalfClipHeight: 0,
  hasGutterClip: false,
  gutterClipX: 0,
  gutterClipY: 0,
  gutterClipWidth: 0,
  gutterClipHeight: 0,
  shadowPoly: new ArrayBuffer(0),
  shadowAlpha: new ArrayBuffer(0),
  spineShadowStrength: 0,
  progress: 0,
  crossedThreshold: false,
};

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

function makeImageFromBytes(bytes: ArrayBuffer) {
  const data = Skia.Data.fromBytes(new Uint8Array(bytes));
  return Skia.Image.MakeImageFromEncoded(data);
}

interface VertexSlice {
  vertices: { x: number; y: number }[];
  textures: { x: number; y: number }[];
  indices: number[];
}

/**
 * Vertex ids and triangle list for one face. The mesh topology is fixed for
 * the life of a solver, so this is computed once and reused every frame —
 * only the point coordinates change as the page curls.
 */
interface Topology {
  unique: Uint16Array;
  triangles: number[];
}

function buildTopology(
  frame: Frame,
  rangeStart: number,
  rangeCount: number,
): Topology {
  const indices = new Uint16Array(frame.indices);
  const seen = new Map<number, number>();
  const order: number[] = [];
  for (let i = 0; i < rangeCount; i += 1) {
    const idx = indices[rangeStart + i];
    if (!seen.has(idx)) {
      seen.set(idx, order.length);
      order.push(idx);
    }
  }
  const triangles = new Array<number>(rangeCount);
  for (let i = 0; i < rangeCount; i += 1) {
    triangles[i] = seen.get(indices[rangeStart + i])!;
  }
  return { unique: Uint16Array.from(order), triangles };
}

function buildVertices(
  frame: Frame,
  topology: Topology | null,
  texWidth: number,
  texHeight: number,
): VertexSlice {
  if (!topology || topology.unique.length === 0) {
    return { vertices: [], textures: [], indices: [] };
  }

  const positions = new Float32Array(frame.positions);
  const uvs = new Float32Array(frame.uvs);
  const unique = topology.unique;

  const verts = new Array<{ x: number; y: number }>(unique.length);
  for (let i = 0; i < unique.length; i += 1) {
    const idx = unique[i];
    verts[i] = { x: positions[idx * 2], y: positions[idx * 2 + 1] };
  }
  // Skia Vertices samples texture coords in the shader's drawing space, not
  // normalized [0,1] — scale the solver's UVs to the page rect the
  // ImageShader is fitted to.
  const texs = new Array<{ x: number; y: number }>(unique.length);
  for (let i = 0; i < unique.length; i += 1) {
    const idx = unique[i];
    texs[i] = {
      x: uvs[idx * 2] * texWidth,
      y: uvs[idx * 2 + 1] * texHeight,
    };
  }

  return { vertices: verts, textures: texs, indices: topology.triangles };
}

export function PageCurlView({
  source,
  pageIndex,
  onPageIndexChange,
  width,
  height,
  meshCols = 24,
  meshRows = 24,
  spread: spreadProp,
  gutter = 0,
}: PageCurlViewProps) {
  const solverRef = useRef<PageCurlSolver | null>(null);
  const layoutRef = useRef<LayoutRectangle>({ x: 0, y: 0, width, height });

  const [currentImage, setCurrentImage] = useState<SkImage | null>(null);
  const [nextImage, setNextImage] = useState<SkImage | null>(null);
  const [leftImage, setLeftImage] = useState<SkImage | null>(null);
  const [frame, setFrame] = useState<Frame>(EMPTY_FRAME);
  // Ref, not state: the rAF loop must see grab changes immediately without
  // re-creating the closure mid-flight.
  const grabbingRef = useRef(false);
  // Mesh topology is fixed once the solver is built; only points move.
  const topologyRef = useRef<{ front: Topology; back: Topology } | null>(null);

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

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

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
    topologyRef.current = {
      front: buildTopology(flat, flat.frontRangeStart, flat.frontRangeCount),
      back: buildTopology(flat, flat.backRangeStart, flat.backRangeCount),
    };
    setFrame(flat);

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
      const [front, under, left] = await Promise.all([
        read(leafIndex),
        read(leafIndex + 1),
        spread ? read(pageIndex) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setCurrentImage(front);
      setNextImage(under ?? front);
      setLeftImage(left);
    })();
    return () => {
      cancelled = true;
    };
  }, [source, pageIndex, leafIndex, spread]);

  const canvasToSolver = useCallback(
    (canvasX: number, canvasY: number) => ({
      x: (canvasX - leafTx) / scale,
      y: (canvasY - ty) / scale,
    }),
    [leafTx, ty, scale],
  );

  const tick = useCallback(
    (timestamp: number) => {
      const solver = solverRef.current;
      if (!solver) return;

      const dt = lastTimeRef.current
        ? Math.min((timestamp - lastTimeRef.current) / 1000, 0.05)
        : 0;
      lastTimeRef.current = timestamp;

      const nextFrame = solver.tick(dt);
      setFrame(nextFrame);

      // While the finger is down the loop must keep running; once released,
      // stop when the spring settles at either extreme and commit at 1.
      if (!grabbingRef.current) {
        if (nextFrame.progress >= 0.999) {
          if (pageIndex + step < source.pageCount) {
            onPageIndexChange?.(pageIndex + step);
          }
          return;
        }
        if (nextFrame.progress <= 0.001) {
          return;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [onPageIndexChange, pageIndex, step, source.pageCount],
  );

  const startLoop = useCallback(() => {
    lastTimeRef.current = 0;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stopLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopLoop();
  }, [stopLoop]);

  const pan = Gesture.Pan()
    .onBegin((event) => {
      const solver = solverRef.current;
      if (!solver) return;
      // Nothing to turn to: refuse the grab rather than leave the leaf
      // stranded mid-curl when the commit is later declined.
      if (pageIndex + step >= source.pageCount) return;
      const p = canvasToSolver(event.x, event.y);
      const grabbed = solver.beginGrab(p.x, p.y);
      if (grabbed) {
        grabbingRef.current = true;
        startLoop();
      }
    })
    .onUpdate((event) => {
      const solver = solverRef.current;
      if (!solver) return;
      const p = canvasToSolver(event.x, event.y);
      solver.updateGrab(p.x, p.y);
    })
    .onEnd((event) => {
      const solver = solverRef.current;
      if (!solver) return;
      grabbingRef.current = false;
      solver.release(event.velocityX, event.velocityY);
    });

  const frontVertices = React.useMemo(() => {
    return buildVertices(
      frame,
      topologyRef.current?.front ?? null,
      box.width,
      box.height,
    );
  }, [frame, box.width, box.height]);

  const backVertices = React.useMemo(() => {
    return buildVertices(
      frame,
      topologyRef.current?.back ?? null,
      box.width,
      box.height,
    );
  }, [frame, box.width, box.height]);

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
            {/* Back of the curling page (shows next page) */}
            {backVertices.vertices.length > 0 && nextImage && (
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
                  vertices={backVertices.vertices}
                  textures={backVertices.textures}
                  indices={backVertices.indices}
                />
              </Group>
            )}
            {/* Front of the curling page (shows current page) */}
            {frontVertices.vertices.length > 0 && currentImage && (
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
                  vertices={frontVertices.vertices}
                  textures={frontVertices.textures}
                  indices={frontVertices.indices}
                />
              </Group>
            )}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}
