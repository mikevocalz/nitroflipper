import { create } from 'zustand';

import type { PageSource } from 'nitro-flipper';
import type { ThemeName } from './theme';

interface Size {
  width: number;
  height: number;
}

/** Which sheet is over the reader, if any. Only one at a time. */
export type Panel = 'none' | 'toc' | 'search' | 'bookmarks' | 'appearance';

export interface Bookmark {
  /** Persistable locator from the engine; chapter-anchored, survives relayout. */
  readonly locator: string;
  /** Page it resolved to when saved, for the list label before we re-resolve. */
  readonly page: number;
  readonly savedAt: number;
}

interface ReaderState {
  source: PageSource | null;
  error: string | null;
  /** Engine error kind, so the UI branches on a value rather than a message. */
  errorKind: string | null;
  size: Size;
  pageIndex: number;
  /** Reader chrome hides so the art owns the panel; tapping brings it back. */
  chromeVisible: boolean;
  /** Mirrors how the reader is paging, so controls move exactly as a flip does. */
  step: number;
  spread: boolean;
  /** Bumped to ask the reader to animate a turn; id changes every request. */
  turnRequest: { dir: number; id: number };

  panel: Panel;
  theme: ThemeName;
  fontSizePt: number;
  /**
   * True while a relayout is in flight.
   *
   * A font-size change repaginates the whole book, which takes long enough to
   * need a state rather than a hopeful synchronous call.
   */
  relayouting: boolean;
  bookmarks: Bookmark[];
  /**
   * Honours the OS reduce-motion setting.
   *
   * Read once at startup and on change; the curl is the whole interaction, so
   * this cannot be an afterthought.
   */
  reduceMotion: boolean;

  setSource: (source: PageSource) => void;
  setError: (error: string, kind?: string) => void;
  clearError: () => void;
  setSize: (size: Size) => void;
  setPageIndex: (pageIndex: number) => void;
  toggleChrome: () => void;
  setLayout: (info: { step: number; spread: boolean }) => void;
  requestTurn: (dir: number) => void;

  setPanel: (panel: Panel) => void;
  setTheme: (theme: ThemeName) => void;
  setFontSizePt: (pt: number) => void;
  setRelayouting: (relayouting: boolean) => void;
  addBookmark: (bookmark: Bookmark) => void;
  removeBookmark: (locator: string) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
}

export const useReaderStore = create<ReaderState>()((set) => ({
  source: null,
  error: null,
  errorKind: null,
  size: { width: 0, height: 0 },
  pageIndex: 0,
  chromeVisible: true,
  step: 1,
  spread: false,
  turnRequest: { dir: 1, id: 0 },

  panel: 'none',
  theme: 'light',
  fontSizePt: 16,
  relayouting: false,
  bookmarks: [],
  reduceMotion: false,

  setSource: (source) => set({ source, error: null, errorKind: null }),
  setError: (error, kind) => set({ error, errorKind: kind ?? null }),
  clearError: () => set({ error: null, errorKind: null }),
  setSize: (size) => set({ size }),
  setPageIndex: (pageIndex) => set({ pageIndex }),
  toggleChrome: () => set((s) => ({ chromeVisible: !s.chromeVisible })),
  setLayout: ({ step, spread }) => set({ step, spread }),
  requestTurn: (dir) =>
    set((s) => ({ turnRequest: { dir, id: s.turnRequest.id + 1 } })),

  setPanel: (panel) => set({ panel }),
  setTheme: (theme) => set({ theme }),
  setFontSizePt: (fontSizePt) => set({ fontSizePt }),
  setRelayouting: (relayouting) => set({ relayouting }),
  addBookmark: (bookmark) =>
    set((s) =>
      // Same locator twice is the same place; adding it again would just make
      // the list lie about how many there are.
      s.bookmarks.some((b) => b.locator === bookmark.locator)
        ? s
        : { bookmarks: [...s.bookmarks, bookmark] },
    ),
  removeBookmark: (locator) =>
    set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.locator !== locator) })),
  setReduceMotion: (reduceMotion) => set({ reduceMotion }),
}));
