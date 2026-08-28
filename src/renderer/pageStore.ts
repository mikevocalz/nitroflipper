import { createStore } from 'zustand/vanilla';
import type { SkImage } from '@shopify/react-native-skia';

export interface SpreadPages {
  fromLeft: SkImage | null;
  fromRight: SkImage | null;
  toLeft: SkImage | null;
  toRight: SkImage | null;
  /** The spread behind the current one, so a backward turn has a destination. */
  prevLeft: SkImage | null;
  prevRight: SkImage | null;
}

interface PageState {
  pages: SpreadPages;
  setPages: (pages: SpreadPages) => void;
}

const EMPTY: SpreadPages = {
  fromLeft: null,
  fromRight: null,
  toLeft: null,
  toRight: null,
  prevLeft: null,
  prevRight: null,
};

/**
 * One store per reader instance, so two readers on screen never share page
 * textures. Vanilla (not a hook factory) because the store is created in a
 * ref and read with `useStore`.
 */
export const createPageStore = () =>
  createStore<PageState>()((set) => ({
    pages: EMPTY,
    setPages: (pages) => set({ pages }),
  }));

export type PageStore = ReturnType<typeof createPageStore>;
