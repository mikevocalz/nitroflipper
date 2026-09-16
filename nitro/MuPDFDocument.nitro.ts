import type { HybridObject } from 'react-native-nitro-modules';
import type { RenderedPage } from './RenderedPage.nitro';
import type {
  DocumentLayout,
  DocumentLocation,
  DocumentPageBox,
  DocumentSnapshot,
  DocumentStyle,
  OutlineEntry,
  SearchResult,
} from './MuPDFTypes';

/**
 * An open PDF or EPUB.
 *
 * Reached through MuPDFFactory.openDocument, never constructed from JS, so it
 * is not autolinked. Every instance owns its own fitz context and a worker
 * thread; MuPDF does not permit two threads inside one document, and cloning
 * the context does not change that.
 *
 * Synchronous members read an immutable snapshot published after the last
 * completed operation. They never touch the document itself, so they cannot
 * block on the worker and cannot observe a half-applied relayout.
 */
export interface MuPDFDocument
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  // --- Snapshot reads. Cheap, synchronous, never block. ---

  readonly pageCount: number;
  readonly isReflowable: boolean;
  readonly format: string;
  /** Bumped by open and close. Stamp on cached renders. */
  readonly documentGeneration: number;
  /** Bumped by every layout. Stamp on cached renders. */
  readonly layoutGeneration: number;
  /** Everything above, read atomically as one consistent set. */
  readonly snapshot: DocumentSnapshot;

  // --- Appearance and pagination ---

  /**
   * Set publisher-style and user-CSS handling for THIS document.
   *
   * Takes effect on the next layout. Applied per document, so a second reader
   * open in the same app keeps its own appearance.
   */
  setStyle(style: DocumentStyle): Promise<void>;

  /**
   * Lay the document out and bump the layout generation.
   *
   * `layout.width` is one column. Passing the width of a two-page spread makes
   * every line run across both pages.
   *
   * A no-op for fixed-layout documents, which resolves without bumping the
   * generation rather than rejecting.
   */
  layout(layout: DocumentLayout): Promise<void>;

  // --- Geometry and navigation ---

  getPageBox(pageNumber: number): Promise<DocumentPageBox>;
  locationForPage(pageNumber: number): Promise<DocumentLocation>;

  /**
   * A persistable reading position.
   *
   * Carries a chapter anchor, so it survives repagination at a different font
   * size. Deliberately NOT an EPUB CFI -- it is meaningful only to this
   * engine. See docs/adr/0004-locator-format.md.
   */
  locatorForPage(pageNumber: number): Promise<string>;

  /** Resolve a locator, or -1 if it does not parse or does not resolve. */
  pageForLocator(locator: string): Promise<number>;

  // --- Content ---

  /**
   * Render one page to fit inside the given box, in device pixels.
   *
   * Resolves to a handle that still holds the pixels natively; ask it for the
   * form you want. The box is a bound, not a target: aspect is preserved, so
   * one dimension will usually come out smaller.
   */
  renderPage(
    pageNumber: number,
    maxWidth: number,
    maxHeight: number,
  ): Promise<RenderedPage>;

  /** Flattened table of contents. Empty when the document has none. */
  getOutline(): Promise<OutlineEntry[]>;

  /**
   * Search the whole document.
   *
   * Cancelled by closing the document, which rejects the pending search rather
   * than leaving it to run to completion.
   */
  search(needle: string, maxHits: number): Promise<SearchResult[]>;

  /**
   * Plain text of one page, for selection and screen readers.
   *
   * Empty for image-only pages. That is reported honestly rather than papered
   * over: this build does not OCR.
   */
  getPageText(pageNumber: number): Promise<string>;

  // --- Lifecycle ---

  /**
   * Supply a password for a document that rejected with `passwordRequired`.
   *
   * Resolves true when accepted. Bumps the document generation on success,
   * because content rendered while locked is not the content now readable.
   */
  authenticate(password: string): Promise<boolean>;

  /**
   * Release the document and its worker thread.
   *
   * Idempotent. Work already queued settles as cancelled rather than hanging,
   * and a job that has not started will not touch the released document.
   */
  close(): void;
}
