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

  setSource: (source: ComicArchiveSource) => void;
  setError: (error: string) => void;
  setSize: (size: Size) => void;
  setPageIndex: (pageIndex: number) => void;
  toggleChrome: () => void;
  setLayout: (info: { step: number; spread: boolean }) => void;
}

export const useReaderStore = create<ReaderState>()((set) => ({
  source: null,
  error: null,
  size: { width: 0, height: 0 },
  pageIndex: 0,
  chromeVisible: true,
  step: 1,
  spread: false,

  setSource: (source) => set({ source }),
  setError: (error) => set({ error }),
  setSize: (size) => set({ size }),
  setPageIndex: (pageIndex) => set({ pageIndex }),
  toggleChrome: () => set((s) => ({ chromeVisible: !s.chromeVisible })),
  setLayout: ({ step, spread }) => set({ step, spread }),
}));
