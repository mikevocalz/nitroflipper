import { create } from 'zustand';

import type { ComicArchiveSource } from 'nitro-flipper';

interface Size {
  width: number;
  height: number;
}

interface ReaderState {
  source: ComicArchiveSource | null;
  error: string | null;
  size: Size;
  pageIndex: number;
  /** Reader chrome hides so the art owns the panel; tapping brings it back. */
  chromeVisible: boolean;
  /** Mirrors how the reader is paging, so controls move exactly as a flip does. */
  step: number;
  spread: boolean;
  /** Bumped to ask the reader to animate a turn; id changes every request. */
  turnRequest: { dir: number; id: number };

  setSource: (source: ComicArchiveSource) => void;
  setError: (error: string) => void;
  setSize: (size: Size) => void;
  setPageIndex: (pageIndex: number) => void;
  toggleChrome: () => void;
  setLayout: (info: { step: number; spread: boolean }) => void;
  requestTurn: (dir: number) => void;
}

export const useReaderStore = create<ReaderState>()((set) => ({
  source: null,
  error: null,
  size: { width: 0, height: 0 },
  pageIndex: 0,
  chromeVisible: true,
  step: 1,
  spread: false,
  turnRequest: { dir: 1, id: 0 },

  setSource: (source) => set({ source }),
  setError: (error) => set({ error }),
  setSize: (size) => set({ size }),
  setPageIndex: (pageIndex) => set({ pageIndex }),
  toggleChrome: () => set((s) => ({ chromeVisible: !s.chromeVisible })),
  setLayout: ({ step, spread }) => set({ step, spread }),
  requestTurn: (dir) =>
    set((s) => ({ turnRequest: { dir, id: s.turnRequest.id + 1 } })),
}));
