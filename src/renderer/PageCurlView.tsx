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

function buildVertices(
  frame: Frame,
  rangeStart: number,
  rangeCount: number,
  texWidth: number,
  texHeight: number,
): VertexSlice {
  if (rangeCount === 0) {
    return { vertices: [], textures: [], indices: [] };
  }

  const positions = new Float32Array(frame.positions);
  const uvs = new Float32Array(frame.uvs);
  const indices = new Uint16Array(frame.indices);

  const pointSet = new Set<number>();
  const indexSlice: number[] = [];
  for (let i = 0; i < rangeCount; i += 1) {
    const idx = indices[rangeStart + i];
    pointSet.add(idx);
    indexSlice.push(idx);
  }
  const unique = Array.from(pointSet).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  unique.forEach((idx, i) => remap.set(idx, i));

  const verts = unique.map((idx) => ({
    x: positions[idx * 2],
    y: positions[idx * 2 + 1],
  }));
  // Skia Vertices samples texture coords in the shader's drawing space, not
  // normalized [0,1] — scale the solver's UVs to the page rect the
  // ImageShader is fitted to.
  const texs = unique.map((idx) => ({
    x: uvs[idx * 2] * texWidth,
    y: uvs[idx * 2 + 1] * texHeight,
  }));
  const triangles = indexSlice.map((idx) => remap.get(idx)!);

  return { vertices: verts, textures: texs, indices: triangles };
}

export function PageCurlView({
  source,
  pageIndex,
  onPageIndexChange,
  width,
  height,
  meshCols = 24,
  meshRows = 24,
}: PageCurlViewProps) {
  const solverRef = useRef<PageCurlSolver | null>(null);
  const layoutRef = useRef<LayoutRectangle>({ x: 0, y: 0, width, height });

  const [currentImage, setCurrentImage] = useState<SkImage | null>(null);
  const [nextImage, setNextImage] = useState<SkImage | null>(null);
  const [frame, setFrame] = useState<Frame>(EMPTY_FRAME);
  // Ref, not state: the rAF loop must see grab changes immediately without
  // re-creating the closure mid-flight.
  const grabbingRef = useRef(false);

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Create a solver for this page size.
  useEffect(() => {
    const solver = NitroModules.createHybridObject<PageCurlSolver>('PageCurlSolver');
    solverRef.current = solver;

    const box = source.getPageBox(pageIndex);
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
    setFrame(solver.tick(0));

    return () => {
      solverRef.current = null;
    };
  }, [source, pageIndex, meshCols, meshRows]);

  // Load textures for the current and next pages.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const currentBytes = await source.readEntryBytes(pageIndex);
      const nextBytes =
        pageIndex + 1 < source.pageCount
          ? await source.readEntryBytes(pageIndex + 1)
          : currentBytes;
      if (cancelled) return;
      setCurrentImage(makeImageFromBytes(currentBytes));
      setNextImage(makeImageFromBytes(nextBytes));
    })();
    return () => {
      cancelled = true;
    };
  }, [source, pageIndex]);

  const canvasToSolver = useCallback(
    (canvasX: number, canvasY: number, box: PageBox) => {
      const scale = Math.min(width / box.width, height / box.height);
      const offsetX = (width - box.width * scale) / 2;
      const offsetY = (height - box.height * scale) / 2;
      return {
        x: (canvasX - offsetX) / scale,
        y: (canvasY - offsetY) / scale,
      };
    },
    [width, height],
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
          if (pageIndex + 1 < source.pageCount) {
            onPageIndexChange?.(pageIndex + 1);
          }
          return;
        }
        if (nextFrame.progress <= 0.001) {
          return;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [onPageIndexChange, pageIndex, source.pageCount],
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
      const box = source.getPageBox(pageIndex);
      if (!solver) return;
      const p = canvasToSolver(event.x, event.y, box);
      const grabbed = solver.beginGrab(p.x, p.y);
      if (grabbed) {
        grabbingRef.current = true;
        startLoop();
      }
    })
    .onUpdate((event) => {
      const solver = solverRef.current;
      const box = source.getPageBox(pageIndex);
      if (!solver) return;
      const p = canvasToSolver(event.x, event.y, box);
      solver.updateGrab(p.x, p.y);
    })
    .onEnd((event) => {
      const solver = solverRef.current;
      if (!solver) return;
      grabbingRef.current = false;
      solver.release(event.velocityX, event.velocityY);
    });

  const box = source.getPageBox(pageIndex);

  const frontVertices = React.useMemo(() => {
    return buildVertices(
      frame,
      frame.frontRangeStart,
      frame.frontRangeCount,
      box.width,
      box.height,
    );
  }, [frame, box.width, box.height]);

  const backVertices = React.useMemo(() => {
    return buildVertices(
      frame,
      frame.backRangeStart,
      frame.backRangeCount,
      box.width,
      box.height,
    );
  }, [frame, box.width, box.height]);
  const scale = Math.min(width / box.width, height / box.height);
  const tx = (width - box.width * scale) / 2;
  const ty = (height - box.height * scale) / 2;

  return (
    <View style={{ width, height }} onLayout={(e) => (layoutRef.current = e.nativeEvent.layout)}>
      <GestureDetector gesture={pan}>
        <Canvas style={{ width, height }}>
          <Group
            transform={[
              { translateX: tx },
              { translateY: ty },
              { scaleX: scale, scaleY: scale },
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
