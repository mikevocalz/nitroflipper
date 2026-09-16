/**
 * Every user-facing string in the reader.
 *
 * In one file so the wording can be reviewed as writing rather than found by
 * grepping JSX, and so accessibility labels sit next to the visible text they
 * describe instead of drifting from it.
 *
 * Rules applied throughout:
 *  - Say what happened and what to do next. "Couldn't open this file" alone
 *    leaves the reader nowhere.
 *  - Name the thing. "This PDF needs a password", not "Authentication required".
 *  - No apologies, no exclamation marks, no blame.
 */

export const STRINGS = {
  library: {
    title: 'Library',
    subtitle: 'Sample documents bundled with this example',
    openLabel: (name: string) => `Open ${name}`,
    formats: {
      pdf: 'PDF',
      epub: 'EPUB',
      cbz: 'Comic archive',
    },
  },

  loading: {
    opening: (format: string) => `Opening ${format}…`,
    /** Shown when a turn outruns the decode, instead of curling onto a blank. */
    page: 'Getting the next page ready…',
  },

  reader: {
    pageOf: (page: number, count: number) => `${page} of ${count}`,
    spreadOf: (left: number, right: number, count: number) =>
      `${left}–${right} of ${count}`,
    previous: 'Previous page',
    next: 'Next page',
    /** Screen readers get the destination, not just the verb. */
    previousHint: 'Goes back one page',
    nextHint: 'Goes forward one page',
    showControls: 'Show reading controls',
    hideControls: 'Hide reading controls',
  },

  toc: {
    title: 'Contents',
    empty: 'This document has no table of contents.',
    /** An outline entry that points nowhere in the current layout. */
    unresolved: 'Not in this edition',
    entryLabel: (title: string, page: number) => `${title}, page ${page}`,
  },

  search: {
    title: 'Search',
    placeholder: 'Search this document',
    searching: 'Searching…',
    /** Names the term so it is obvious what was searched. */
    noResults: (term: string) => `No matches for “${term}”`,
    noResultsHint: 'Check the spelling, or try a shorter phrase.',
    resultCount: (n: number) =>
      n === 1 ? '1 match' : `${n} matches`,
    /** Long scans can be abandoned; say so rather than hiding the option. */
    cancel: 'Stop searching',
    resultLabel: (page: number) => `Match on page ${page}`,
    imageOnly:
      'This document has no searchable text. It looks like scanned images, which this reader does not read text from.',
  },

  bookmarks: {
    title: 'Bookmarks',
    empty: 'No bookmarks yet.',
    emptyHint: 'Add one from the reading controls to come back to a page.',
    add: 'Add bookmark',
    remove: 'Remove bookmark',
    added: 'Bookmark added',
    /** A saved position whose chapter no longer exists in this file. */
    stale: 'This bookmark no longer resolves in this document.',
    itemLabel: (page: number) => `Bookmark, page ${page}`,
  },

  appearance: {
    title: 'Appearance',
    textSize: 'Text size',
    textSizeHint: 'Only applies to reflowable documents like EPUB.',
    /** A fixed-layout file cannot reflow; say why rather than greying silently. */
    textSizeFixed:
      'This document has a fixed layout, so its text size cannot change.',
    theme: 'Paper',
    themes: {
      light: 'Light',
      sepia: 'Sepia',
      dark: 'Dark',
    },
    smaller: 'Smaller text',
    larger: 'Larger text',
    currentSize: (pt: number) => `${pt} point`,
  },

  password: {
    title: 'This document is protected',
    body: 'Enter the password to open it.',
    placeholder: 'Password',
    submit: 'Open',
    cancel: 'Cancel',
    /** Distinct from the first prompt: the reader needs to know it was tried. */
    wrong: 'That password did not work. Check it and try again.',
    label: 'Document password',
  },

  errors: {
    title: 'Cannot open this document',
    malformed:
      'This file is damaged or is not a document this reader understands.',
    unsupported:
      'This reader cannot open this document. It may use DRM, which is not supported.',
    outOfMemory:
      'There was not enough memory to render this page. Closing other apps may help.',
    cancelled: 'That was cancelled.',
    generic: 'Something went wrong opening this document.',
    /** Always paired with a way forward, never a dead end. */
    retry: 'Try again',
    back: 'Back to library',
    /** The raw engine message, behind a disclosure, for bug reports. */
    details: 'Technical details',
  },
} as const;
