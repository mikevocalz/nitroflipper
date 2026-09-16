import { NitroModules } from 'react-native-nitro-modules';

import type {
  Layout,
  Locator,
  PageBox,
  PageSource,
  ProgressionDirection,
  SpreadIntent,
  SpreadSlot,
} from '../types';
import type { MuPDFFactory } from '../../nitro/MuPDFFactory.nitro';
import type { MuPDFDocument } from '../../nitro/MuPDFDocument.nitro';
import type {
  DocumentErrorKind,
  DocumentLayout,
  DocumentStyle,
  OutlineEntry,
  SearchResult,
} from '../../nitro/MuPDFTypes';

/**
 * A failure from the document engine, with the reason already parsed out.
 *
 * Nitro has no typed-error channel, so the native side prefixes its message
 * with `mupdf/<kind>: `. Parsing it here means exactly one place knows about
 * that convention and the UI branches on a real union.
 */
export class DocumentError extends Error {
  readonly kind: DocumentErrorKind;

  constructor(kind: DocumentErrorKind, message: string) {
    super(message);
    this.name = 'DocumentError';
    this.kind = kind;
  }

  /** True when supplying a password could make this succeed. */
  get needsPassword(): boolean {
    return this.kind === 'passwordRequired' || this.kind === 'wrongPassword';
  }
}

const ERROR_PREFIX = /^mupdf\/([a-zA-Z]+):\s*/;

function toDocumentError(error: unknown): DocumentError {
  const message = error instanceof Error ? error.message : String(error);
  const match = ERROR_PREFIX.exec(message);
  if (match === null) {
    return new DocumentError('generic', message);
  }
  return new DocumentError(
    match[1] as DocumentErrorKind,
    message.slice(match[0].length),
  );
}

/** Run a native call, converting its rejection into a DocumentError. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toDocumentError(error);
  }
}

let factory: MuPDFFactory | null = null;

function sharedFactory(): MuPDFFactory {
  if (factory === null) {
    factory = NitroModules.createHybridObject<MuPDFFactory>('MuPDFFactory');
  }
  return factory;
}

/** File extensions this build can open, for a picker's filter. */
export function supportedDocumentExtensions(): string[] {
  return sharedFactory().supportedExtensions;
}

export interface MuPDFSourceOptions {
  /** Applied before the first layout. */
  readonly style?: DocumentStyle;
  /**
   * Layout box for reflowable documents, in points.
   *
   * `width` is ONE column. For a two-page spread pass the width of a single
   * leaf; passing the full spread width makes lines run across both pages.
   */
  readonly layout?: DocumentLayout;
}

/**
 * PageSource over a MuPDF-backed PDF or EPUB.
 *
 * The renderer's PageSource contract is synchronous for geometry and async for
 * bytes, which is the shape the native side already publishes: snapshot reads
 * are cheap and never touch the document, so the synchronous half is honest
 * rather than a cached guess.
 *
 * Page geometry is the exception. PageSource.getPageBox is synchronous but the
 * engine's is not, so boxes are prefetched during open() and after every
 * relayout. `prefetchPageBoxes` bounds how many.
 */
export class MuPDFSource implements PageSource {
  private document: MuPDFDocument | null = null;
  private boxes = new Map<number, PageBox>();
  private _layout: DocumentLayout | null = null;
  private _closed = false;

  /**
   * How many page boxes to resolve eagerly.
   *
   * A PDF with uniform page sizes needs one; a mixed-size PDF needs them all,
   * and asking for all of a 900-page scan at open costs real time. Pages past
   * this fall back to the first known box until something asks for them
   * asynchronously via refreshPageBox.
   */
  static prefetchPageBoxes = 64;

  static async open(
    path: string,
    options: MuPDFSourceOptions = {},
    password?: string,
  ): Promise<MuPDFSource> {
    const source = new MuPDFSource();
    const document = await guarded(() =>
      sharedFactory().openDocument(path, password),
    );
    source.document = document;

    if (options.style !== undefined) {
      await guarded(() => document.setStyle(options.style as DocumentStyle));
    }
    if (options.layout !== undefined && document.isReflowable) {
      await guarded(() => document.layout(options.layout as DocumentLayout));
      source._layout = options.layout;
    }

    await source.refreshPageBoxes();
    return source;
  }

  private constructor() {}

  private require(): MuPDFDocument {
    if (this.document === null || this._closed) {
      throw new DocumentError('cancelled', 'document is closed');
    }
    return this.document;
  }

  // --- PageSource ---

  get pageCount(): number {
    return this.document === null || this._closed ? 0 : this.document.pageCount;
  }

  /**
   * MuPDF does not report a spread intent, so this is always 'auto' and the
   * renderer's width test decides. Claiming an intent the document never
   * declared would be a guess dressed as metadata.
   */
  get spreadIntent(): SpreadIntent {
    return 'auto';
  }

  /**
   * Reading direction.
   *
   * Always 'ltr' today. MuPDF handles RTL *text* internally, but the engine
   * does not yet surface the spine's page-progression-direction, so an
   * RTL-bound book will page the wrong way. Tracked as a known limitation
   * rather than silently guessed from the document's language.
   */
  get progressionDirection(): ProgressionDirection {
    return 'ltr';
  }

  layoutOf(): Layout {
    if (this.document === null || this._closed) {
      return 'fixed';
    }
    return this.document.isReflowable ? 'reflowable' : 'fixed';
  }

  spreadSlotOf(): SpreadSlot {
    return 'auto';
  }

  getPageBox(index: number): PageBox {
    const known = this.boxes.get(index);
    if (known !== undefined) {
      return known;
    }
    // Past the prefetch window. The first page's box is the best available
    // answer and is correct for the common uniform-size document; a mixed-size
    // PDF gets the right value once refreshPageBox resolves.
    const first = this.boxes.get(0);
    if (first !== undefined) {
      return first;
    }
    return { width: 0, height: 0 };
  }

  locatorForPage(index: number): Locator {
    const count = this.pageCount;
    return {
      href: `mupdf:${index}`,
      locations: {
        position: index,
        progression: count > 0 ? index / count : 0,
      },
    };
  }

  pageForLocator(loc: Locator): number {
    const position = loc.locations?.position;
    if (typeof position === 'number') {
      return position;
    }
    const progression = loc.locations?.progression;
    if (typeof progression === 'number') {
      return Math.floor(progression * this.pageCount);
    }
    return 0;
  }

  /**
   * A PDF page is not an archived image, so there is no "entry" to hand back
   * untouched. This renders at the page's own size in points, which keeps the
   * call bounded instead of rasterising a poster at full resolution.
   */
  async readEntryBytes(index: number): Promise<ArrayBuffer> {
    const box = this.getPageBox(index);
    const width = box.width > 0 ? Math.ceil(box.width) : 1024;
    const height = box.height > 0 ? Math.ceil(box.height) : 1024;
    return this.readPageScaled(index, width, height);
  }

  async readPageScaled(
    index: number,
    maxWidth: number,
    maxHeight: number,
  ): Promise<ArrayBuffer> {
    const document = this.require();
    const page = await guarded(() =>
      document.renderPage(index, maxWidth, maxHeight),
    );

    // Reject a render produced under a pagination that has since changed. The
    // renderer would otherwise cache it against the current page index and
    // show the wrong content until something else evicts it.
    if (
      page.documentGeneration !== document.documentGeneration ||
      page.layoutGeneration !== document.layoutGeneration
    ) {
      throw new DocumentError(
        'cancelled',
        'page was rendered under a superseded layout',
      );
    }
    return guarded(() => page.toArrayBuffer());
  }

  // --- Beyond PageSource ---

  /** Generations to stamp on anything cached from this source. */
  get generations(): { document: number; layout: number } {
    const document = this.document;
    if (document === null || this._closed) {
      return { document: 0, layout: 0 };
    }
    return {
      document: document.documentGeneration,
      layout: document.layoutGeneration,
    };
  }

  /**
   * Relayout at a new box or font size, then refresh cached geometry.
   *
   * A no-op for fixed-layout documents, which keeps callers from having to ask
   * first.
   */
  async relayout(layout: DocumentLayout): Promise<void> {
    const document = this.require();
    if (!document.isReflowable) {
      return;
    }
    await guarded(() => document.layout(layout));
    this._layout = layout;
    this.boxes.clear();
    await this.refreshPageBoxes();
  }

  /** Change appearance. Takes effect on the next relayout. */
  async setStyle(style: DocumentStyle): Promise<void> {
    const document = this.require();
    await guarded(() => document.setStyle(style));
    if (this._layout !== null) {
      await this.relayout(this._layout);
    }
  }

  async getOutline(): Promise<OutlineEntry[]> {
    const document = this.require();
    return guarded(() => document.getOutline());
  }

  async search(needle: string, maxHits = 200): Promise<SearchResult[]> {
    const document = this.require();
    return guarded(() => document.search(needle, maxHits));
  }

  /** Page text for selection and screen readers. Empty for image-only pages. */
  async getPageText(index: number): Promise<string> {
    const document = this.require();
    return guarded(() => document.getPageText(index));
  }

  /**
   * A persistable reading position.
   *
   * Carries a chapter anchor so it survives a font-size change. Not an EPUB
   * CFI, and must not be presented as one.
   */
  async persistentLocator(index: number): Promise<string> {
    const document = this.require();
    return guarded(() => document.locatorForPage(index));
  }

  /** Resolve a stored locator, or null when it no longer resolves. */
  async pageForPersistentLocator(locator: string): Promise<number | null> {
    const document = this.require();
    const page = await guarded(() => document.pageForLocator(locator));
    return page < 0 ? null : page;
  }

  /** Supply a password after open() rejected with `passwordRequired`. */
  async authenticate(password: string): Promise<boolean> {
    const document = this.require();
    const ok = await guarded(() => document.authenticate(password));
    if (ok) {
      this.boxes.clear();
      await this.refreshPageBoxes();
    }
    return ok;
  }

  /** Resolve one page's true box, for documents with mixed page sizes. */
  async refreshPageBox(index: number): Promise<PageBox> {
    const document = this.require();
    const box = await guarded(() => document.getPageBox(index));
    const value: PageBox = { width: box.width, height: box.height };
    this.boxes.set(index, value);
    return value;
  }

  private async refreshPageBoxes(): Promise<void> {
    const document = this.document;
    if (document === null) {
      return;
    }
    const limit = Math.min(document.pageCount, MuPDFSource.prefetchPageBoxes);
    for (let index = 0; index < limit; index += 1) {
      // Sequential: these all queue on the same worker thread anyway, and
      // firing them together only deepens the queue ahead of the first render.
      const box = await guarded(() => document.getPageBox(index));
      this.boxes.set(index, { width: box.width, height: box.height });
    }
  }

  close(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this.boxes.clear();
    this.document?.close();
    this.document = null;
  }
}
