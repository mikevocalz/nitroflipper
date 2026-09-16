import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PageTextureCache,
  pageKeyOf,
  textureBytes,
  type PageKey,
} from '../PageTextureCache';

/** Minimal stand-in for SkImage: only dispose() matters to the cache. */
function fakeImage() {
  const image = {
    disposed: false,
    dispose() {
      // A double dispose is a real crash on the native side, so the test
      // treats it as a failure rather than tolerating it.
      assert.equal(image.disposed, false, 'image disposed twice');
      image.disposed = true;
    },
  };
  return image as unknown as import('@shopify/react-native-skia').SkImage & {
    disposed: boolean;
  };
}

const base: PageKey = {
  documentId: 'book-a',
  documentGeneration: 1,
  layoutGeneration: 1,
  pageIndex: 0,
  renderWidth: 100,
  renderHeight: 200,
  rotation: 0,
  appearance: 'default',
};

const key = (over: Partial<PageKey> = {}): PageKey => ({ ...base, ...over });

describe('PageKey identity', () => {
  it('separates pages that differ in any identity field', () => {
    const ids = new Set(
      [
        key(),
        key({ pageIndex: 1 }),
        key({ documentId: 'book-b' }),
        key({ documentGeneration: 2 }),
        key({ layoutGeneration: 2 }),
        key({ renderWidth: 101 }),
        key({ renderHeight: 201 }),
        key({ rotation: 90 }),
        key({ appearance: 'sepia' }),
      ].map(pageKeyOf),
    );
    // Nine distinct keys. Collapsing any pair is the bug this replaces: the
    // old cache keyed on pageIndex alone, so eight of these collided.
    assert.equal(ids.size, 9);
  });

  it('gives the same key for the same identity', () => {
    assert.equal(pageKeyOf(key()), pageKeyOf(key()));
  });
});

describe('byte budget', () => {
  it('evicts by bytes, not by count', () => {
    const disposed: string[] = [];
    const cache = new PageTextureCache({
      budgetBytes: 1000,
      onDispose: (id) => disposed.push(id),
    });

    cache.set(key({ pageIndex: 0 }), fakeImage(), 400);
    cache.set(key({ pageIndex: 1 }), fakeImage(), 400);
    assert.equal(cache.bytes, 800);
    assert.equal(cache.size, 2);

    // One big page pushes past the budget and evicts the oldest.
    cache.set(key({ pageIndex: 2 }), fakeImage(), 400);
    assert.ok(cache.bytes <= 1000, `bytes ${cache.bytes} over budget`);
    assert.equal(disposed.length, 1);
  });

  it('evicts least-recently-used first', () => {
    const disposed: string[] = [];
    const cache = new PageTextureCache({
      budgetBytes: 800,
      onDispose: (id) => disposed.push(id),
    });

    cache.set(key({ pageIndex: 0 }), fakeImage(), 400);
    cache.set(key({ pageIndex: 1 }), fakeImage(), 400);
    // Touching page 0 makes page 1 the oldest.
    cache.peek(key({ pageIndex: 0 }));
    cache.set(key({ pageIndex: 2 }), fakeImage(), 400);

    assert.equal(disposed.length, 1);
    assert.ok(disposed[0].includes('|1|'), `evicted wrong entry: ${disposed[0]}`);
  });
});

describe('retain and release', () => {
  it('does not dispose an image the frame is still drawing', () => {
    const cache = new PageTextureCache({ budgetBytes: 400 });
    const first = fakeImage();
    cache.set(key({ pageIndex: 0 }), first, 400);

    // The frame takes a reference, then the budget forces an eviction.
    const retained = cache.retain(key({ pageIndex: 0 }));
    assert.equal(retained, first);

    cache.set(key({ pageIndex: 1 }), fakeImage(), 400);

    // Evicted from the map, but alive: the shader may still be sampling it.
    assert.equal(cache.has(key({ pageIndex: 0 })), false);
    assert.equal(first.disposed, false);

    cache.release(key({ pageIndex: 0 }));
    assert.equal(first.disposed, true);
  });

  it('holds until the last of several retains is released', () => {
    const cache = new PageTextureCache({ budgetBytes: 400 });
    const image = fakeImage();
    cache.set(key(), image, 400);

    cache.retain(key());
    cache.retain(key());
    cache.set(key({ pageIndex: 9 }), fakeImage(), 400); // forces eviction

    cache.release(key());
    assert.equal(image.disposed, false, 'released too early');
    cache.release(key());
    assert.equal(image.disposed, true);
  });

  it('ignores a release for something it never held', () => {
    const cache = new PageTextureCache({ budgetBytes: 1000 });
    cache.release(key({ pageIndex: 42 }));
    assert.equal(cache.size, 0);
  });

  it('keeps a retained image usable after eviction', () => {
    const cache = new PageTextureCache({ budgetBytes: 400 });
    const image = fakeImage();
    cache.set(key(), image, 400);
    cache.retain(key());
    cache.set(key({ pageIndex: 5 }), fakeImage(), 400);

    // Still reachable through retain, which is what a second frame needs.
    assert.equal(cache.retain(key()), image);
    cache.release(key());
    cache.release(key());
    assert.equal(image.disposed, true);
  });
});

describe('invalidation', () => {
  it('drops pages from a superseded layout', () => {
    const disposed: string[] = [];
    const cache = new PageTextureCache({
      budgetBytes: 10_000,
      onDispose: (id) => disposed.push(id),
    });

    cache.set(key({ pageIndex: 0 }), fakeImage(), 100);
    cache.set(key({ pageIndex: 1 }), fakeImage(), 100);
    cache.set(key({ pageIndex: 0, layoutGeneration: 2 }), fakeImage(), 100);

    // A relayout landed: only generation 2 is still valid.
    cache.invalidateExcept('book-a', 1, 2);

    assert.equal(cache.size, 1);
    assert.equal(disposed.length, 2);
    assert.ok(cache.has(key({ pageIndex: 0, layoutGeneration: 2 })));
  });

  it('drops everything when the document changes', () => {
    const cache = new PageTextureCache({ budgetBytes: 10_000 });
    cache.set(key({ pageIndex: 0 }), fakeImage(), 100);
    cache.set(key({ pageIndex: 1 }), fakeImage(), 100);

    cache.invalidateExcept('book-b', 1, 1);
    assert.equal(cache.size, 0);
    assert.equal(cache.bytes, 0);
  });

  it('does not dispose a retained image during invalidation', () => {
    const cache = new PageTextureCache({ budgetBytes: 10_000 });
    const image = fakeImage();
    cache.set(key(), image, 100);
    cache.retain(key());

    cache.invalidateExcept('book-b', 1, 1);
    assert.equal(image.disposed, false, 'disposed while a frame held it');

    cache.release(key());
    assert.equal(image.disposed, true);
  });
});

describe('duplicate insertion', () => {
  it('disposes the loser when two loaders race the same page', () => {
    const cache = new PageTextureCache({ budgetBytes: 10_000 });
    const first = fakeImage();
    const second = fakeImage();

    const kept = cache.set(key(), first, 100);
    const alsoKept = cache.set(key(), second, 100);

    assert.equal(kept, first);
    assert.equal(alsoKept, first, 'should return the already-cached image');
    assert.equal(second.disposed, true, 'the orphan must not leak');
    assert.equal(cache.bytes, 100, 'must not double-count bytes');
  });
});

describe('textureBytes', () => {
  it('counts RGBA', () => {
    assert.equal(textureBytes(10, 10), 400);
  });

  it('rounds partial pixels up', () => {
    assert.equal(textureBytes(10.2, 10), 440);
  });

  it('never returns negative', () => {
    assert.equal(textureBytes(-5, 10), 0);
  });
});
