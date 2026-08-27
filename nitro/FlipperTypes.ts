export type Mode = 'single' | 'spread';
export type Leaf = 'recto' | 'verso';
export type Axis = 'vertical' | 'horizontal';

export interface Hinge {
  readonly start: number;
  readonly end: number;
  readonly occludes: boolean;
}

export interface Config {
  readonly mode: Mode;
  readonly spineAxis: Axis;
  readonly spinePosition: number;
  readonly hinge?: Hinge;
  readonly grabbed: Leaf;
  readonly rtl: boolean;
  readonly meshCols: number;
  readonly meshRows: number;
}

export interface Frame {
  /** 2D book-space vertex positions as interleaved x,y floats. */
  readonly positions: ArrayBuffer;
  /** Normalized UV coordinates as interleaved u,v floats. */
  readonly uvs: ArrayBuffer;
  /** Triangle indices as uint16 values. */
  readonly indices: ArrayBuffer;

  /** Sub-range of `indices` for the front face. */
  readonly frontRangeStart: number;
  readonly frontRangeCount: number;
  /** Sub-range of `indices` for the back face. */
  readonly backRangeStart: number;
  readonly backRangeCount: number;

  /** Rectangle covering the static half/page in book space. */
  readonly staticHalfClipX: number;
  readonly staticHalfClipY: number;
  readonly staticHalfClipWidth: number;
  readonly staticHalfClipHeight: number;

  /** Optional gutter clip when running on a true dual-screen device. */
  readonly hasGutterClip: boolean;
  readonly gutterClipX: number;
  readonly gutterClipY: number;
  readonly gutterClipWidth: number;
  readonly gutterClipHeight: number;

  /** Shadow polygon as interleaved x,y floats. */
  readonly shadowPoly: ArrayBuffer;
  /** Per-vertex shadow alphas. */
  readonly shadowAlpha: ArrayBuffer;
  readonly spineShadowStrength: number;

  /** 0..1 page-turn progress. */
  readonly progress: number;
  /** True for the single frame where progress crosses 0.5. */
  readonly crossedThreshold: boolean;
}
