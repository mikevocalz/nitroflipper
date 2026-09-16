import type { SkImage } from '@shopify/react-native-skia';

/**
 * Everything that makes a cached page distinct.
 *
 * Keying by page index alone is wrong three ways at once: after a relayout,
 * page 7 is different content; after a viewport change it needs a different
 * raster size; after a document swap it is a different book. All three collide
 * on the same key, and the collision shows as the wrong page on screen.
 *
 * See docs/adr/0003-cache-identity-and-budget.md.
 */
export interface PageKey {
  readonly documentId: string;
  readonly documentGeneration: number;
  readonly layoutGeneration: number;
  readonly pageIndex: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly rotation: number;
  /** Hash of anything else that changes pixels: theme, font size, user CSS. */
  readonly appearance: string;
}

export function pageKeyOf(key: PageKey): string {
  return [
    key.documentId,
    key.documentGeneration,
    key.layoutGeneration,
    key.pageIndex,
    key.renderWidth,
    key.renderHeight,
    key.rotation,
    key.appearance,
  ].join('|');
}

interface Entry {
  readonly image: SkImage;
  readonly bytes: number;
  /**
   * How many frames or loaders still need this image alive.
   *
   * Eviction cannot dispose an image the shader may still be sampling this
   * frame. Disposing under a live frame is a use-after-free on the GPU side,
   * and it is why the previous implementation could flash or crash on a fast
   * turn. An evicted-but-retained image is dropped from the map immediately
   * and disposed when the last holder releases it.
   */
  retainCount: number;
  evicted: boolean;
  lastUsed: number;
}

export interface PageTextureCacheOptions {
  /**
   * Ceiling for decoded page images, in bytes.
   *
   * Counting images rather than bytes is not a memory bound: six tablet pages
   * at 3x are not six phone pages at 2x. This is separate from fitz's own
   * store budget, which the native engine owns.
   */
  readonly budgetBytes: number;
  /** Called when an image is genuinely released, for tests and diagnostics. */
  readonly onDispose?: (key: string, bytes: number) => void;
}

/**
 * Byte-budgeted LRU for decoded page textures, with explicit lifetime.
 *
 * The renderer retains what the current frame draws and releases it when that
 * frame is replaced, so eviction never pulls a texture out from under the
 * shader.
 */
export class PageTextureCache {
  private entries = new Map<string, Entry>();
  private held = new Map<string, Entry>();
  private clock = 0;
  private bytesUsed = 0;

  constructor(private readonly options: PageTextureCacheOptions) {}

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.bytesUsed;
  }

  /** Bytes still alive because something retains them, though evicted. */
  get retainedBytes(): number {
    let total = 0;
    for (const entry of this.held.values()) {
      total += entry.bytes;
    }
    return total;
  }

  has(key: PageKey): boolean {
    return this.entries.has(pageKeyOf(key));
  }

  /** Look up without retaining. Refreshes recency. */
  peek(key: PageKey): SkImage | null {
    const entry = this.entries.get(pageKeyOf(key));
    if (entry === undefined) {
      return null;
    }
    this.clock += 1;
    entry.lastUsed = this.clock;
    return entry.image;
  }

  /**
   * Insert an image, evicting by least-recent use until it fits.
   *
   * If the same key is already present the new image is disposed and the
   * existing one kept, so two loaders racing the same page cannot leave an
   * orphan.
   */
  set(key: PageKey, image: SkImage, bytes: number): SkImage {
    const id = pageKeyOf(key);
    const existing = this.entries.get(id);
    if (existing !== undefined) {
      if (existing.image !== image) {
        image.dispose();
      }
      return existing.image;
    }

    this.clock += 1;
    this.entries.set(id, {
      image,
      bytes,
      retainCount: 0,
      evicted: false,
      lastUsed: this.clock,
    });
    this.bytesUsed += bytes;
    this.evictToBudget();
    return image;
  }

  /**
   * Mark an image as in use by a frame.
   *
   * Retained images survive eviction from the map; they are disposed once the
   * last release lands.
   */
  retain(key: PageKey): SkImage | null {
    const id = pageKeyOf(key);
    const entry = this.entries.get(id) ?? this.held.get(id);
    if (entry === undefined) {
      return null;
    }
    entry.retainCount += 1;
    this.held.set(id, entry);
    this.clock += 1;
    entry.lastUsed = this.clock;
    return entry.image;
  }

  /** Release a retain. Disposes if it was evicted and this was the last one. */
  release(key: PageKey): void {
    const id = pageKeyOf(key);
    const entry = this.held.get(id);
    if (entry === undefined) {
      return;
    }
    entry.retainCount -= 1;
    if (entry.retainCount > 0) {
      return;
    }
    this.held.delete(id);
    if (entry.evicted) {
      this.dispose(id, entry);
    }
  }

  /**
   * Drop everything belonging to a superseded document or layout.
   *
   * Called when the source changes or a relayout lands, so a late loader
   * cannot repopulate a cache that belongs to a book no longer on screen.
   */
  invalidateExcept(documentId: string, documentGeneration: number, layoutGeneration: number): void {
    for (const [id, entry] of Array.from(this.entries.entries())) {
      const [docId, docGen, layoutGen] = id.split('|');
      if (
        docId !== documentId ||
        Number(docGen) !== documentGeneration ||
        Number(layoutGen) !== layoutGeneration
      ) {
        this.remove(id, entry);
      }
    }
  }

  /** Release everything. Retained images are disposed as their holders let go. */
  clear(): void {
    for (const [id, entry] of Array.from(this.entries.entries())) {
      this.remove(id, entry);
    }
  }

  private evictToBudget(): void {
    if (this.bytesUsed <= this.options.budgetBytes) {
      return;
    }
    // Least-recently-used first. Retained entries leave the map but stay alive.
    const ordered = Array.from(this.entries.entries()).sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    );
    for (const [id, entry] of ordered) {
      if (this.bytesUsed <= this.options.budgetBytes) {
        return;
      }
      this.remove(id, entry);
    }
  }

  private remove(id: string, entry: Entry): void {
    this.entries.delete(id);
    this.bytesUsed -= entry.bytes;
    entry.evicted = true;
    if (entry.retainCount <= 0) {
      this.dispose(id, entry);
    }
    // Otherwise it stays in `held` and is disposed by the last release().
  }

  private dispose(id: string, entry: Entry): void {
    this.held.delete(id);
    entry.image.dispose();
    this.options.onDispose?.(id, entry.bytes);
  }
}

/** Bytes an RGBA texture of this size occupies once decoded. */
export function textureBytes(width: number, height: number): number {
  return Math.max(0, Math.ceil(width) * Math.ceil(height) * 4);
}
