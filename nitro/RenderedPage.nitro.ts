import type { HybridObject } from 'react-native-nitro-modules';

/**
 * One rendered page, holding its pixels natively until asked for them.
 *
 * A HybridObject rather than an ArrayBuffer return because a page raster is
 * megabytes and the caller does not always want both forms. Nitro converts
 * struct fields eagerly, so a struct carrying the bytes would copy them into
 * JS whether or not anything read them. Here `toArrayBuffer()` is the only
 * thing that costs, and it is only called for the form actually used.
 */
export interface RenderedPage
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** Output size in device pixels, after fitting into the requested box. */
  readonly width: number;
  readonly height: number;

  /**
   * Generations this page was rendered under.
   *
   * A result that arrives after a reopen or a relayout carries the old pair;
   * compare against the document's current values and drop it rather than
   * painting the wrong pagination.
   */
  readonly documentGeneration: number;
  readonly layoutGeneration: number;

  /** Bytes per row of the raw form. Not width * components in general. */
  readonly stride: number;
  /** Samples per pixel of the raw form. 4 for RGBA. */
  readonly components: number;
  /** Whether the raw form's colour is premultiplied by alpha. */
  readonly premultiplied: boolean;

  /**
   * The page as a lossless PNG, for Skia's MakeImageFromEncoded.
   *
   * Lossless because the curl shader samples this at arbitrary scales and JPEG
   * ringing on text is visible under the fold.
   */
  toArrayBuffer(): Promise<ArrayBuffer>;

  /**
   * The page as raw pixels, skipping the encode and decode entirely.
   *
   * Use with `stride`, `components` and `premultiplied` above -- do not assume
   * a tightly packed buffer.
   */
  toRawArrayBuffer(): Promise<ArrayBuffer>;
}
