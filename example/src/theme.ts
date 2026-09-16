/**
 * Reader tokens.
 *
 * Three themes rather than two: a reader that is only light/dark forces night
 * readers onto pure white or pure black, and sepia is the setting long-form
 * readers actually reach for. Paper colour is a reading decision, not a
 * branding one, so it lives here next to the type scale.
 *
 * Kept deliberately small — every value below is used. Tokens nothing consumes
 * are just a second place to be wrong.
 */

export type ThemeName = 'light' | 'sepia' | 'dark';

export interface Theme {
  readonly name: ThemeName;
  /** Behind the pages. Never pure black: a hard edge against paper is harsh. */
  readonly canvas: string;
  /** Sheets, sheets' own surfaces, and raised chrome. */
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly text: string;
  readonly textMuted: string;
  readonly accent: string;
  /** On top of `accent`; paired so contrast is decided once, here. */
  readonly onAccent: string;
  readonly divider: string;
  /** Scrim behind a modal sheet. */
  readonly scrim: string;
  /** CSS handed to MuPDF so page paper matches the app chrome. */
  readonly pageCss: string;
}

/**
 * Contrast notes (WCAG 2.1 AA needs 4.5:1 for body text, 3:1 for large text
 * and UI boundaries). Measured pairs:
 *   light  text #1A1A1A on surface #FFFFFF  -> 17.4:1
 *   sepia  text #3B2F1E on surface #F4ECD8  -> 10.1:1
 *   dark   text #E8E6E3 on surface #1C1C1E  -> 13.6:1
 * textMuted is held above 4.5:1 too, because it carries page counts and
 * search context that people actually need to read.
 */
export const THEMES: Record<ThemeName, Theme> = {
  light: {
    name: 'light',
    canvas: '#E5E5E7',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    text: '#1A1A1A',
    textMuted: '#5C5C60',
    accent: '#1B6EF3',
    onAccent: '#FFFFFF',
    divider: '#D8D8DC',
    scrim: 'rgba(0,0,0,0.32)',
    pageCss: 'body { background: #FFFFFF; color: #1A1A1A; }',
  },
  sepia: {
    name: 'sepia',
    canvas: '#E4D9BF',
    surface: '#F4ECD8',
    surfaceRaised: '#FBF5E6',
    text: '#3B2F1E',
    textMuted: '#6B5A42',
    accent: '#9A5B1F',
    onAccent: '#FFFFFF',
    divider: '#D9C9A6',
    scrim: 'rgba(59,47,30,0.32)',
    pageCss: 'body { background: #F4ECD8; color: #3B2F1E; }',
  },
  dark: {
    name: 'dark',
    canvas: '#0E0E10',
    surface: '#1C1C1E',
    surfaceRaised: '#2A2A2D',
    text: '#E8E6E3',
    textMuted: '#A0A0A6',
    accent: '#63A0FF',
    onAccent: '#0E0E10',
    divider: '#3A3A3E',
    scrim: 'rgba(0,0,0,0.55)',
    // Inverting a scanned PDF is wrong -- it turns photographs into negatives.
    // Only reflowable text takes the dark paper; MuPDF applies this to HTML
    // content only, which is exactly the distinction we want.
    pageCss: 'body { background: #1C1C1E; color: #E8E6E3; }',
  },
};

/** 4pt base. Anything not on this scale is a mistake, not a nuance. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const TYPE = {
  title: { fontSize: 20, fontWeight: '600' as const, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '500' as const, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
} as const;

/**
 * Minimum hit target.
 *
 * 44 is the smaller of the two platform minimums (iOS 44pt, Android 48dp), so
 * meeting it everywhere means meeting neither guideline's letter on Android.
 * 48 is the floor here for that reason.
 */
export const HIT_SLOP_MIN = 48;

/**
 * Widest a sheet gets, in dp. Tailwind's 3xl.
 *
 * Spanned, the Surface Duo is 1080dp across; a full-bleed list would put a
 * chapter title and its page number a hand's width apart with the fold running
 * down the middle of every row. Measure is a reading constraint, not only a
 * typographic one.
 */
export const SHEET_MAX_WIDTH = 768;

/** Text sizes offered for reflowable documents, in points. */
export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28] as const;

export const MOTION = {
  /** A page turn. Long enough to read as paper, short enough not to wait. */
  turnMs: 320,
  /** Sheets and chrome. */
  sheetMs: 220,
  /**
   * With reduce-motion on, transitions become instant rather than merely
   * faster. A shortened animation is still animation.
   */
  reducedMs: 0,
} as const;
