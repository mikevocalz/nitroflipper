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
