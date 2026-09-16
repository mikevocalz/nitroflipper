import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { pagePlacement } from './pagePlacement';

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
}

const FLICK_VELOCITY = 400;
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
  onSpreadVisible, onPageLoadError,
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
  const scale = PixelRatio.get();
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
    const paint = Skia.Paint();
    paint.setColor(Skia.Color(PAGE_BACKGROUND));
    if (current && effect) {
      const shader = effect.makeShaderWithChildren([
        progress.value, current.width, current.height, current.width / 2,
        dir.value, current.rtl ? -dir.value : dir.value,
      ], current.children);
      paint.setShader(shader);
      shader.dispose();
    }
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
    if (landed !== 0) consumed.current.add(landed);
    if (generation !== epoch.current) return;
    travel.current = forward ? 1 : -1;
    callbacks.current.onPageIndexChange?.(target);
  }, []);

  useEffect(() => {
    const generation = ++epoch.current;
    let cancelled = false;
    const staged: number[] = [];
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
        forwardWidth: placement(base.start + base.size - 1).width,
        backwardWidth: placement(base.start).width,
        next: ahead?.start ?? null,
        previous: behind?.start ?? null,
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

  const pan = Gesture.Pan().activeOffsetX([-8, 8]).failOffsetY([-24, 24])
    .onStart((event) => {
      'worklet';
      const current = frame.value;
      if (!canTurn || !current || turning.value || current.generation !== requested.value) return;
      const forward = current.rtl ? event.x < current.width / 2 : event.x > current.width / 2;
      if ((forward ? current.next : current.previous) === null) return;
      dragging.value = true;
      dir.value = forward ? 1 : -1;
      progress.value = 0;
    })
    .onUpdate((event) => {
      'worklet';
      const current = frame.value;
      if (!dragging.value || !current || turning.value) return;
      const forward = dir.value > 0;
      const sign = (forward !== current.rtl) ? -1 : 1;
      const leafWidth = forward ? current.forwardWidth : current.backwardWidth;
      progress.value = Math.min(Math.max(event.translationX * sign / leafWidth, 0), 1);
    })
    .onEnd((event) => {
      'worklet';
      const current = frame.value;
      if (!dragging.value || !current || turning.value) return;
      dragging.value = false;
      const forward = dir.value > 0;
      const target = forward ? current.next : current.previous;
      const away = event.velocityX * (forward !== current.rtl ? -1 : 1);
      const shouldCommit = target !== null && (Math.abs(away) > FLICK_VELOCITY
        ? away > 0 : progress.value > COMMIT_AT);
      const leafWidth = forward ? current.forwardWidth : current.backwardWidth;
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
      'worklet';
      if (!dragging.value) return;
      dragging.value = false;
      turning.value = true;
      progress.value = withSpring(0, { damping: 22, stiffness: 200, overshootClamping: true },
        (finished) => { if (finished) turning.value = false; });
    });

  return (
    <View style={{ width, height }}>
      <GestureDetector gesture={pan}>
        <Canvas style={{ width, height }} opaque>
          <Fill color={PAGE_BACKGROUND} />
          <Fill paint={paint} />
        </Canvas>
      </GestureDetector>
    </View>
  );
}
