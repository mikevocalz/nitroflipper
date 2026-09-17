import assert from 'node:assert/strict';
import { it } from 'node:test';
import { FrameLifetime } from '../FrameLifetime';

it('keeps the previous frame alive while a replacement is only staged', () => {
  const lifetime = new FrameLifetime();
  const released: number[] = [];
  const first = lifetime.stage(() => released.push(1));
  lifetime.recorded(first);
  const second = lifetime.stage(() => released.push(2));
  assert.deepEqual(released, []);
  lifetime.recorded(second);
  assert.deepEqual(released, [1]);
  lifetime.clear();
  assert.deepEqual(released, [1, 2]);
});

it('ignores late acknowledgements and retires superseded unpublished frames', () => {
  const lifetime = new FrameLifetime();
  const released: number[] = [];
  const first = lifetime.stage(() => released.push(1));
  const skipped = lifetime.stage(() => released.push(2));
  const latest = lifetime.stage(() => released.push(3));
  lifetime.recorded(latest);
  lifetime.recorded(first);
  lifetime.recorded(skipped);
  lifetime.recorded(latest);
  assert.deepEqual(released, [1, 2]);
  lifetime.clear();
  lifetime.clear();
  assert.deepEqual(released, [1, 2, 3]);
});

it('discards a cancelled submission exactly once without releasing the display', () => {
  const lifetime = new FrameLifetime();
  const released: string[] = [];
  const visible = lifetime.stage(() => released.push('visible'));
  lifetime.recorded(visible);
  const cancelled = lifetime.stage(() => released.push('cancelled'));
  lifetime.discard(cancelled);
  lifetime.discard(cancelled);
  assert.deepEqual(released, ['cancelled']);
  lifetime.clear();
  assert.deepEqual(released, ['cancelled', 'visible']);
});

it('keeps a staged landing alive after a newer current frame is built', () => {
  // The loader stages the frame a flick will land on, then keeps rebuilding
  // the *current* frame as neighbours decode -- each rebuild taking a newer
  // revision than the landing already holds. Sweeping on revision order alone
  // frees a frame the UI runtime is still pointing at, and the next flick
  // draws disposed shaders.
  const lifetime = new FrameLifetime();
  const released: string[] = [];
  const base = lifetime.stage(() => released.push('base'));
  lifetime.recorded(base);

  const ahead = lifetime.stage(() => released.push('ahead'));
  const behind = lifetime.stage(() => released.push('behind'));
  lifetime.hold(ahead);
  lifetime.hold(behind);

  // A neighbour finished decoding: same position, rebuilt frame, newer revision.
  const rebuilt = lifetime.stage(() => released.push('rebuilt'));
  lifetime.recorded(rebuilt);
  assert.deepEqual(released, ['base'], 'a held landing must survive the sweep');

  // The reader flicks forward and takes it. Now it is the displayed frame and
  // retires on the next handoff like any other.
  lifetime.taken(ahead);
  const next = lifetime.stage(() => released.push('next'));
  lifetime.recorded(next);
  // Released in the order they were staged, so the landing precedes the
  // rebuild it outlived.
  assert.deepEqual(released, ['base', 'ahead', 'rebuilt']);

  // The landing nobody took is still held, and only an explicit discard frees it.
  lifetime.discard(behind);
  assert.deepEqual(released, ['base', 'ahead', 'rebuilt', 'behind']);
  lifetime.clear();
  assert.deepEqual(released, ['base', 'ahead', 'rebuilt', 'behind', 'next']);
});

it('retires a superseded landing rather than leaking it once held', () => {
  const lifetime = new FrameLifetime();
  const released: string[] = [];
  const stale = lifetime.stage(() => released.push('stale'));
  lifetime.hold(stale);
  const fresh = lifetime.stage(() => released.push('fresh'));
  lifetime.hold(fresh);
  lifetime.discard(stale);
  assert.deepEqual(released, ['stale']);
  lifetime.clear();
  assert.deepEqual(released, ['stale', 'fresh']);
});
