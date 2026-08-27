export type ProgressionDirection = 'ltr' | 'rtl';

export type SpreadIntent =
  | 'none'
  | 'landscape'
  | 'portrait'
  | 'both'
  | 'auto';

export type SpreadSlot = 'left' | 'right' | 'center' | 'auto';

export interface PageBox {
  readonly width: number;
  readonly height: number;
}

export interface PageLocation {
  readonly progression: number;
}

export interface ComicPageLocator {
  readonly href: string;
  readonly locations: PageLocation;
}
