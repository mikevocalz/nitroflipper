import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, it } from 'node:test';
import CanvasKitInit, { type CanvasKit, type RuntimeEffect, type Shader } from 'canvaskit-wasm';
import { PAGE_CURL_SKSL } from '../pageCurlShader';
import { leafHinge, pagePlacement } from '../pagePlacement';

const require = createRequire(import.meta.url);
let skia: CanvasKit;
let effect: RuntimeEffect;
const width = 120;
const height = 80;

before(async () => {
  skia = await CanvasKitInit({ locateFile: (file) => require.resolve(`canvaskit-wasm/bin/${file}`) });
  const compiled = skia.RuntimeEffect.Make(PAGE_CURL_SKSL);
  assert.ok(compiled, 'production SkSL must compile');
  effect = compiled;
});
after(() => effect?.delete());

function page(color: number[], slot: 'left' | 'right' | 'center'): Shader {
  const box = slot === 'center' ? { width: 140, height: 80 } : { width: 50, height: 80 };
  const rect = pagePlacement(box, slot, width, height, gutter);
  const image = skia.MakeImage({ width: 1, height: 1,
    colorType: skia.ColorType.RGBA_8888, alphaType: skia.AlphaType.Unpremul,
    colorSpace: skia.ColorSpace.SRGB }, new Uint8Array([...color, 255]), 4)!;
  const shader = image.makeShaderOptions(skia.TileMode.Decal, skia.TileMode.Decal,
    skia.FilterMode.Nearest, skia.MipmapMode.None,
    [rect.width, 0, rect.x, 0, rect.height, rect.y, 0, 0, 1]);
  image.delete(); // shader owns an independent native reference
  return shader;
}

const gutter = 8;
/** Page geometry the fixtures use, mirrored from what PageCurlView measures. */
const leafPageWidth = 50;

function pixels(children: Shader[], progress: number, dir: number, rtl: boolean,
  spread = true, landingSpread = spread, zoom = { scale: 1, x: 0, y: 0 },
  // Default pane is the whole viewport: no pane restriction, which is what a
  // reader at fit scale has.
  pane = { x: 0, y: 0, width, height }) {
  const surface = skia.MakeSurface(width, height)!;
  const leafSign = rtl ? -dir : dir;
  const span = spread ? leafPageWidth + gutter / 2 : width;
  const { spineX, leafW } = leafHinge(width, span, spread, leafSign);
  const shader = effect.makeShaderWithChildren(
    [progress, width / 2, dir, spineX, leafW, leafSign,
      landingSpread ? -leafSign : leafSign, zoom.scale, zoom.x, zoom.y,
      pane.x, pane.y, pane.x + pane.width, pane.y + pane.height], children);
  const paint = new skia.Paint();
  paint.setShader(shader);
  shader.delete(); // paint keeps the shader alive through submission
  surface.getCanvas().clear(skia.BLACK);
  surface.getCanvas().drawPaint(paint);
  const result = surface.getCanvas().readPixels(0, 0, {
    width, height, colorType: skia.ColorType.RGBA_8888,
    alphaType: skia.AlphaType.Unpremul, colorSpace: skia.ColorSpace.SRGB,
  });
  assert.ok(result);
  const copy = new Uint8Array(result);
  paint.delete();
  surface.delete();
  return copy;
}

for (const rtl of [false, true]) {
  for (const dir of [1, -1]) {
    it(`lands pixel-identically across single/spread layouts (rtl=${rtl}, dir=${dir})`, () => {
      const spread = [page([255, 0, 0], 'left'), page([0, 255, 0], 'right')];
      const solo = [page([0, 0, 255], 'center'), page([0, 0, 255], 'center')];
      for (const [from, to] of [[spread, solo], [solo, spread]]) {
        const ending = pixels([...from, ...to, ...to], 1, dir, rtl);
        const landing = pixels([...to, ...from, ...from], 0, dir, rtl);
        assert.deepEqual(ending, landing);
        assert.ok(ending.some((value, i) => i % 4 !== 3 && value > 0), 'page has content');
      }
      for (const shader of [...spread, ...solo]) shader.delete();
    });
  }
}

it('selects the requested neighbour and preserves physical page slots at both endpoints', () => {
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]];
  const children = colors.map((color, i) => page(color, i % 2 ? 'right' : 'left'));
  for (const rtl of [false, true]) {
    for (const [progress, dir, offset] of [[0, 1, 0], [0, -1, 0], [1, 1, 2], [1, -1, 4]]) {
      const image = pixels(children, progress, dir, rtl);
      for (const [x, side] of [[30, 0], [90, 1]]) {
        const at = (40 * width + x) * 4;
        assert.deepEqual([...image.slice(at, at + 3)], colors[offset + side]);
      }
    }
  }
  for (const shader of children) shader.delete();
});

it('draws intermediate curl frames with opaque content across the full turn', () => {
  const children = [page([255, 0, 0], 'left'), page([0, 255, 0], 'right'),
    page([0, 0, 255], 'left'), page([255, 255, 0], 'right'),
    page([255, 0, 255], 'left'), page([0, 255, 255], 'right')];
  for (const dir of [1, -1]) {
    for (const progress of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      const image = pixels(children, progress, dir, false);
      assert.ok(image.some((value, i) => i % 4 !== 3 && value > 0));
      assert.ok(image.every((value, i) => i % 4 !== 3 || value === 255));
    }
  }
  for (const shader of children) shader.delete();
});

/** Column of pixels at x, as RGB triples, to compare one turn frame to another. */
function column(image: Uint8Array, x: number) {
  return Array.from({ length: height }, (_, y) =>
    [...image.slice((y * width + x) * 4, (y * width + x) * 4 + 3)]);
}

for (const rtl of [false, true]) {
  for (const dir of [1, -1]) {
    it(`leaves the facing page untouched for the whole turn (rtl=${rtl}, dir=${dir})`, () => {
      const children = [page([255, 0, 0], 'left'), page([0, 255, 0], 'right'),
        page([0, 0, 255], 'left'), page([255, 255, 0], 'right'),
        page([255, 0, 255], 'left'), page([0, 255, 255], 'right')];
      // A leaf is hinged at the spine, so only its own half moves. The facing
      // page sits still until the turned leaf lands on top of it -- which,
      // with the free edge at 1 - 2t, cannot start before halfway.
      const rest = pixels(children, 0, dir, rtl);
      // Leaf is right of the spine when (rtl ? -dir : dir) > 0.
      const facing = (rtl ? -dir : dir) > 0 ? 20 : 100;
      for (const progress of [0.05, 0.2, 0.35, 0.49]) {
        assert.deepEqual(column(pixels(children, progress, dir, rtl), facing),
          column(rest, facing), `facing page moved at progress ${progress}`);
      }
      // ...and by the end it is covered by the back of the leaf, not still bare.
      assert.notDeepEqual(column(pixels(children, 0.9, dir, rtl), facing),
        column(rest, facing), 'leaf never reached the facing page');
      for (const shader of children) shader.delete();
    });

    it(`uncovers the leaf from its free edge to the spine (rtl=${rtl}, dir=${dir})`, () => {
      // Only the destination page on the leaf's own side carries any red, so
      // "where does red start" is exactly where the roll ends and the page it
      // is uncovering begins. That boundary has to march from the free edge to
      // the spine and get there -- a leaf hinged anywhere else stalls short.
      const leafSign = rtl ? -dir : dir;
      const revealed = (dir > 0 ? 2 : 4) + (leafSign > 0 ? 1 : 0);
      const children = [0, 1, 2, 3, 4, 5].map((i) => page(
        i === revealed ? [255, 0, 0] : [0, 60 + i * 30, 200 - i * 30],
        i % 2 ? 'right' : 'left'));
      const { spineX, leafW } = leafHinge(width, leafPageWidth + gutter / 2, true, leafSign);
      const uncoveredFrom = (progress: number) => {
        const image = pixels(children, progress, dir, rtl);
        for (let step = 0; step <= 100; step++) {
          const u = step / 100;
          const x = Math.round(spineX + leafSign * u * leafW);
          // Shadow can take 45% off the revealed page; nothing else has red.
          if (image[(40 * width + Math.min(Math.max(x, 0), width - 1)) * 4] > 80) return u;
        }
        return 1;
      };
      let previous = 1.01;
      for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const at = uncoveredFrom(progress);
        assert.ok(at < previous, `uncovered edge went backwards at ${progress}: ${at}`);
        previous = at;
      }
      assert.ok(previous < 0.25, `leaf stalled ${previous} of the way from the spine`);
      for (const shader of children) shader.delete();
    });
  }
}

it('prints the next page on the back of a single centred leaf', () => {
  // A centred page has no facing page to fold onto, so its destination is
  // drawn on the leaf's own side of the hinge. Reading the back from the
  // mirrored side finds nothing there and the leaf turns blank.
  const from = [page([0, 255, 0], 'center'), page([0, 255, 0], 'center')];
  const to = [page([255, 0, 0], 'center'), page([255, 0, 0], 'center')];
  for (const dir of [1, -1]) {
    const children = dir > 0 ? [...from, ...to, ...from] : [...from, ...from, ...to];
    // x=20 at half-turn is inside the folded-back band, well clear of the roll.
    const at = (40 * width + 20) * 4;
    const back = [...pixels(children, 0.5, dir, false, false, false).slice(at, at + 3)];
    assert.ok(back[0] > back[1], `back of the leaf is not the next page: ${back}`);
    assert.ok(back[1] < 120, `back of the leaf fell through to blank paper: ${back}`);
  }
  for (const shader of [...from, ...to]) shader.delete();
});

it('magnifies the fitted page about the view transform', () => {
  // viewport = scale * fitted + translate, so at 2x centred on the spine the
  // left page fills the left half of the screen on its own. Sampling a column
  // that showed the left page at rest must still show the left page; sampling
  // one that showed the right page must now show the left page too, because
  // the left page has grown over it.
  const children = [page([255, 0, 0], 'left'), page([0, 255, 0], 'right'),
    page([0, 0, 255], 'left'), page([255, 255, 0], 'right'),
    page([255, 0, 255], 'left'), page([0, 255, 255], 'right')];
  const at = (image: Uint8Array, x: number) =>
    [...image.slice((40 * width + x) * 4, (40 * width + x) * 4 + 3)];

  const rest = pixels(children, 0, 1, false);
  assert.deepEqual(at(rest, 30), [255, 0, 0], 'left page at rest');
  assert.deepEqual(at(rest, 90), [0, 255, 0], 'right page at rest');

  // 2x about the viewport centre: fitted x = (screen - tx) / 2 with tx = -60,
  // so screen x = 90 reads fitted x = 75 -- still the right page -- and
  // screen x = 30 reads fitted x = 45, which is the gutter/left page edge.
  const zoomed = pixels(children, 0, 1, false, true, true,
    { scale: 2, x: -width / 2, y: -height / 2 });
  assert.deepEqual(at(zoomed, 90), [0, 255, 0], 'right page still under x=90');
  // A column that was the far right edge of the page is now off the page, and
  // decal leaves it transparent over the reader's background rather than
  // wrapping the texture.
  assert.deepEqual(at(zoomed, 20), [255, 0, 0], 'left page magnified across x=20');

  assert.deepEqual(pixels(children, 0, 1, false, true, true, { scale: 1, x: 0, y: 0 }), rest,
    'an identity transform must be byte-identical to no transform');
  for (const shader of children) shader.delete();
});

it('leaves the facing page alone while the other pane is magnified', () => {
  // A spread is two leaves that happen to be visible together. Magnifying the
  // recto must not move a single pixel of the verso -- the complaint this
  // pane-scoping exists to answer.
  const children = [page([255, 0, 0], 'left'), page([0, 255, 0], 'right'),
    page([0, 0, 255], 'left'), page([255, 255, 0], 'right'),
    page([255, 0, 255], 'left'), page([0, 255, 255], 'right')];
  const recto = { x: width / 2, y: 0, width: width / 2, height };
  const rest = pixels(children, 0, 1, false);
  const magnified = pixels(children, 0, 1, false, true, true,
    { scale: 2, x: -width / 2, y: -height / 2 }, recto);

  for (let x = 0; x < width / 2; x++) {
    assert.deepEqual(column(magnified, x), column(rest, x),
      `verso moved at x=${x} while the recto was magnified`);
  }
  // ...and the recto really did magnify, so the check above is not vacuous.
  //
  // The fixtures are flat colours, so the only visible consequence of scaling
  // one is that its edges move: at rest the recto ends at x=114 and the strip
  // past it is background, and at 2x about the pane it covers that strip.
  const at = (image: Uint8Array, x: number) =>
    [...image.slice((40 * width + x) * 4, (40 * width + x) * 4 + 3)];
  assert.notDeepEqual(at(rest, 117), [0, 255, 0], 'fixture: x=117 is past the recto at rest');
  assert.deepEqual(at(magnified, 117), [0, 255, 0], 'recto did not grow over its own margin');
  for (const shader of children) shader.delete();
});
