/**
 * Shared codegen types for the MuPDF document source.
 *
 * Kept out of the .nitro.ts files so the specs stay one-HybridObject-per-file.
 */

/** Why an operation failed, in a form the UI can branch on. */
export type DocumentErrorKind =
  | 'generic'
  | 'malformed'
  | 'passwordRequired'
  | 'wrongPassword'
  | 'unsupported'
  | 'outOfMemory'
  | 'cancelled';

/**
 * Where a page sits in a chapter-structured document.
 *
 * EPUB numbers pages within a chapter, so a flat index alone cannot address a
 * page across a relayout. Both are carried: `chapter`/`page` is the anchor,
 * `pageNumber` is the flattened position for list UI.
 */
export interface DocumentLocation {
  readonly chapter: number;
  readonly page: number;
  readonly pageNumber: number;
}

/** Page size in points, before any device scale. */
export interface DocumentPageBox {
  readonly width: number;
  readonly height: number;
}

/**
 * Appearance for reflowable documents.
 *
 * Applied per document via fz_style_document, so two open readers cannot
 * disturb each other's layout.
 */
export interface DocumentStyle {
  /** Honour the publisher's own CSS. */
  readonly usePublisherStyles: boolean;
  /** Extra CSS applied on top. Empty means none. */
  readonly userCss: string;
}

/**
 * The box a reflowable document is laid out into.
 *
 * `width` is ONE column. For a two-page spread pass the width of a single
 * leaf, not the whole spread, or every line runs the full width of both pages.
 */
export interface DocumentLayout {
  readonly width: number;
  readonly height: number;
  readonly fontSizePt: number;
}

/** One table-of-contents entry, flattened with an explicit depth. */
export interface OutlineEntry {
  readonly title: string;
  readonly depth: number;
  /** Empty when the entry has no resolvable destination. */
  readonly uri: string;
  /** -1 when the entry does not resolve to a page in this layout. */
  readonly pageNumber: number;
  readonly chapter: number;
  readonly page: number;
}

/** One search result, with its quad in page coordinates. */
export interface SearchResult {
  readonly pageNumber: number;
  readonly chapter: number;
  readonly page: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * The state of an open document, captured after an async operation.
 *
 * Published as an immutable snapshot so synchronous reads from JS are cheap
 * and never touch the document while the worker thread holds it.
 */
export interface DocumentSnapshot {
  readonly pageCount: number;
  readonly isReflowable: boolean;
  readonly needsPassword: boolean;
  readonly format: string;
  /** Bumped by open and close. */
  readonly documentGeneration: number;
  /** Bumped by every layout. */
  readonly layoutGeneration: number;
}
