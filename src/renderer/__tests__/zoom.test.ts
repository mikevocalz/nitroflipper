import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampZoom, FIT, paneAt, rasterDensity, toFitted, toViewport, zoomAbout, zoomPercent,
  type ZoomBounds, type ZoomTransform,
} from '../zoom';

const W = 400;
const H = 300;
const LIMITS = { min: 1, max: 4 };
/** The whole viewport, i.e. a single-page reader. */
const PAGE: ZoomBounds = { x: 0, y: 0, width: W, height: H };
/** The right half of a spread, i.e. the recto of a two-page layout. */
const RECTO: ZoomBounds = { x: 200, y: 0, width: 200, height: H };

describe('focal point', () => {
  it('keeps the content under the fingers while the scale changes', () => {
    // The whole point of a pinch: whatever pixel was under the midpoint of the
    // fingers stays there. Checked away from the edges, where clamping is
    // allowed to move the page instead.
    let transform: ZoomTransform = FIT;
    const focal = { x: 210, y: 160 };
    const held = toFitted(transform, focal.x, focal.y);
    for (const scale of [1.2, 1.7, 2.4, 3.1, 2.2, 1.6]) {
      transform = zoomAbout(transform, focal.x, focal.y, scale, PAGE, LIMITS);
      const now = toViewport(transform, held.x, held.y);
      assert.ok(Math.abs(now.x - focal.x) < 1e-9, `x drifted at ${scale}: ${now.x}`);
      assert.ok(Math.abs(now.y - focal.y) < 1e-9, `y drifted at ${scale}: ${now.y}`);
    }
  });

  it('reads the anchor from the gesture start, not the live transform', () => {
    // Anchoring against the live transform while the focal point also moves
    // counts the movement twice and the page crawls. Same start + same focal
    // must land in the same place however many steps it took to get there.
    const start = zoomAbout(FIT, 200, 150, 2, PAGE, LIMITS);
    const oneStep = zoomAbout(start, 180, 140, 3, PAGE, LIMITS);
    let creeping = start;
    for (const s of [2.25, 2.5, 2.75, 3]) {
      creeping = zoomAbout(start, 180, 140, s, PAGE, LIMITS);
    }
    assert.deepEqual(creeping, oneStep);
  });

  it('holds the page still when a pinch ends and a new one begins', () => {
    // Rebasing on pointer-count change: the second gesture starts from where
    // the first left off, so nothing jumps as a finger lifts or arrives.
    const after = zoomAbout(FIT, 120, 90, 2.5, PAGE, LIMITS);
    const resumed = zoomAbout(after, 120, 90, 2.5, PAGE, LIMITS);
    assert.deepEqual(resumed, after);
  });
});

describe('bounds', () => {
  it('never exposes an edge while the page is larger than the viewport', () => {
    for (const scale of [1.5, 2, 4]) {
      for (const [x, y] of [[9999, 9999], [-9999, -9999], [0, 0]]) {
        const t = clampZoom({ scale, x, y }, PAGE);
        assert.ok(t.x <= 1e-9 && t.x >= W * (1 - scale) - 1e-9, `x ${t.x} at ${scale}`);
        assert.ok(t.y <= 1e-9 && t.y >= H * (1 - scale) - 1e-9, `y ${t.y} at ${scale}`);
      }
    }
  });

  it('centres an axis that is smaller than the viewport instead of drifting', () => {
    const t = clampZoom({ scale: 0.5, x: 120, y: -80 }, PAGE);
    assert.equal(t.x, W * 0.5 / 2);
    assert.equal(t.y, H * 0.5 / 2);
    // ...and that really is centred: equal gaps on both sides.
    assert.equal(t.x, (W - W * 0.5) / 2);
  });

  it('is the identity at fit', () => {
    assert.deepEqual(clampZoom(FIT, PAGE), { scale: 1, x: 0, y: 0 });
  });

  it('pulls a corner zoom back onto the page', () => {
    // Pinching in the corner asks for a translation that would show past the
    // edge; the result stays legal without changing the scale.
    const t = zoomAbout(FIT, 0, 0, 3, PAGE, LIMITS);
    assert.equal(t.scale, 3);
    assert.equal(t.x, 0);
    assert.equal(t.y, 0);
    const far = zoomAbout(FIT, W, H, 3, PAGE, LIMITS);
    assert.equal(far.x, W * (1 - 3));
    assert.equal(far.y, H * (1 - 3));
  });

  it('honours the scale limits', () => {
    assert.equal(zoomAbout(FIT, 200, 150, 99, PAGE, LIMITS).scale, 4);
    assert.equal(zoomAbout(FIT, 200, 150, 0.01, PAGE, LIMITS).scale, 1);
  });
});

describe('coordinate inversion', () => {
  it('round-trips viewport and fitted points', () => {
    for (const t of [FIT, { scale: 2.5, x: -130, y: -90 }, { scale: 1.3, x: -20, y: 0 }]) {
      for (const [x, y] of [[0, 0], [200, 150], [399, 299], [37, 288]]) {
        const back = toViewport(t, toFitted(t, x, y).x, toFitted(t, x, y).y);
        assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9);
      }
    }
  });
});

describe('raster density', () => {
  const room = 8192;
  it('quantises to powers of two and rounds up, so it is never softer than the screen', () => {
    assert.equal(rasterDensity(1, 400, 300, room, 4), 1);
    assert.equal(rasterDensity(1.1, 400, 300, room, 4), 2);
    assert.equal(rasterDensity(2, 400, 300, room, 4), 2);
    assert.equal(rasterDensity(2.01, 400, 300, room, 4), 4);
    assert.equal(rasterDensity(4, 400, 300, room, 4), 4);
  });

  it('never asks for more than the zoom ceiling', () => {
    assert.equal(rasterDensity(16, 400, 300, room, 4), 4);
  });

  it('backs off to what a texture can hold', () => {
    // A 3000pt page at 4x is 12000px on its long side -- past the limit, so it
    // settles for the largest power of two that fits rather than failing to
    // allocate mid-pinch.
    assert.equal(rasterDensity(4, 3000, 2000, room, 4), 2);
    assert.equal(rasterDensity(4, 7000, 2000, room, 4), 1);
    assert.equal(rasterDensity(4, 99999, 2000, room, 4), 1);
  });

  it('survives a degenerate page', () => {
    assert.equal(rasterDensity(4, 0, 0, room, 4), 1);
  });
});

it('reports 100% for the fitted page', () => {
  assert.equal(zoomPercent(1), 100);
  assert.equal(zoomPercent(2.5), 250);
});

describe('reading panes', () => {
  it('bounds magnification to the pane, not the viewport', () => {
    // Pinching the recto of a spread must not let it slide over the verso.
    // At 2x the recto spans 400pt starting from its own left edge, so the
    // legal translations are exactly the ones that keep it covering x 200-400.
    const t = zoomAbout(FIT, 300, 150, 2, RECTO, LIMITS);
    assert.equal(t.scale, 2);
    const left = t.scale * RECTO.x + t.x;
    const right = t.scale * (RECTO.x + RECTO.width) + t.x;
    assert.ok(left <= RECTO.x + 1e-9, `recto left edge slid inwards: ${left}`);
    assert.ok(right >= RECTO.x + RECTO.width - 1e-9, `recto right edge slid inwards: ${right}`);
  });

  it('cannot pan the recto across the spine however hard it is dragged', () => {
    for (const x of [99999, -99999]) {
      const t = clampZoom({ scale: 3, x, y: 0 }, RECTO);
      const left = t.scale * RECTO.x + t.x;
      assert.ok(left <= RECTO.x + 1e-9, `covered past the spine: ${left}`);
    }
  });

  it('is still the identity at fit, whichever pane is claimed', () => {
    assert.deepEqual(clampZoom(FIT, RECTO), { scale: 1, x: 0, y: 0 });
    assert.deepEqual(clampZoom(FIT, PAGE), { scale: 1, x: 0, y: 0 });
  });

  it('picks the pane the gesture started on', () => {
    const verso: ZoomBounds = { x: 0, y: 0, width: 190, height: H };
    const panes = [verso, RECTO];
    assert.equal(paneAt(panes, 50), verso);
    assert.equal(paneAt(panes, 300), RECTO);
    // A touch in the gutter belongs to the nearer page rather than nothing.
    assert.equal(paneAt(panes, 196), RECTO);
    assert.equal(paneAt(panes, 192), verso);
    assert.equal(paneAt([], 10), null);
  });
});

describe('returning to fit', () => {
  it('lands exactly on 1, not a hair above it', () => {
    // A fit that stops at 1.005 still counts as magnified: one-finger drags
    // keep panning by a few pixels and never turn the page again. The animated
    // path interpolates toward the target and must write the endpoint itself
    // rather than leaving the last interpolated frame in place.
    const magnified = zoomAbout(FIT, 300, 200, 3, PAGE, LIMITS);
    const target = zoomAbout(magnified, 300, 200, 1, PAGE, LIMITS);
    assert.equal(target.scale, 1);
    assert.deepEqual(target, { scale: 1, x: 0, y: 0 });
    assert.equal(zoomPercent(target.scale), 100);

    // Anything short of the endpoint is what the bug looked like.
    const nearlyThere = {
      scale: magnified.scale + (target.scale - magnified.scale) * 0.997,
      x: magnified.x + (target.x - magnified.x) * 0.997,
      y: magnified.y + (target.y - magnified.y) * 0.997,
    };
    assert.notEqual(nearlyThere.scale, 1);
    assert.ok(nearlyThere.scale > 1, 'the penultimate frame still reads as magnified');
  });
});
