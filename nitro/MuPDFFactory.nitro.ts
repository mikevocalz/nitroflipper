import type { HybridObject } from 'react-native-nitro-modules';
import type { MuPDFDocument } from './MuPDFDocument.nitro';

/**
 * The autolinked root. Default-constructible, holds no document state.
 *
 * Opening is a factory method rather than a constructor argument because a
 * document needs parsing, may need a password, and may fail -- all of which
 * belong in a Promise, not a constructor.
 *
 * This is the only MuPDF HybridObject registered in nitro.json. MuPDFDocument
 * and RenderedPage are reached through it and never constructed from JS.
 */
export interface MuPDFFactory
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /**
   * Open a PDF or EPUB at an absolute file path.
   *
   * Rejects with `passwordRequired` when the file is encrypted and no password
   * was supplied; call again with one. A wrong password rejects with
   * `wrongPassword`, which is a different state and a different message.
   *
   * The resolved document is already parsed: there is no separate ready step
   * and no window where its page count is a lie.
   */
  openDocument(path: string, password?: string): Promise<MuPDFDocument>;

  /** Formats this build can open, for the document picker's filter. */
  readonly supportedExtensions: string[];
}
