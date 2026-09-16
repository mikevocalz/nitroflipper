import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, it } from 'node:test';
import CanvasKitInit, { type CanvasKit, type RuntimeEffect, type Shader } from 'canvaskit-wasm';
import { PAGE_CURL_SKSL } from '../pageCurlShader';
import { pagePlacement } from '../pagePlacement';

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
  const rect = pagePlacement(box, slot, width, height, 8);
  const image = skia.MakeImage({ width: 1, height: 1,
    colorType: skia.ColorType.RGBA_8888, alphaType: skia.AlphaType.Unpremul,
    colorSpace: skia.ColorSpace.SRGB }, new Uint8Array([...color, 255]), 4)!;
  const shader = image.makeShaderOptions(skia.TileMode.Decal, skia.TileMode.Decal,
    skia.FilterMode.Nearest, skia.MipmapMode.None,
    [rect.width, 0, rect.x, 0, rect.height, rect.y, 0, 0, 1]);
  image.delete(); // shader owns an independent native reference
  return shader;
}

function pixels(children: Shader[], progress: number, dir: number, rtl: boolean) {
  const surface = skia.MakeSurface(width, height)!;
  const shader = effect.makeShaderWithChildren(
    [progress, width, height, width / 2, dir, rtl ? -dir : dir], children);
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
