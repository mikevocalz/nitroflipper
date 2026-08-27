import type { HybridObject } from 'react-native-nitro-modules';
import type {
  ComicPageLocator,
  PageBox,
  ProgressionDirection,
  SpreadIntent,
  SpreadSlot,
} from './ComicTypes';

export interface ComicArchiveSource
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** Open a CBZ/CBR archive at the given absolute file path. */
  open(path: string): Promise<void>;

  /** Close the archive and release native resources. */
  close(): void;

  /** Number of page entries in reading order. */
  readonly pageCount: number;

  /** Reading progression declared by the archive (ComicInfo.xml or auto). */
  readonly progressionDirection: ProgressionDirection;

  /** Spread intent declared by the archive. */
  readonly spreadIntent: SpreadIntent;

  /** Return the intrinsic pixel size of the page. */
  getPageBox(index: number): PageBox;

  /** Return the explicit spread slot, or 'auto'. */
  getSpreadSlot(index: number): SpreadSlot;

  /** Return the encoded image bytes for a page (JPEG/PNG/WebP). */
  readEntryBytes(index: number): Promise<ArrayBuffer>;

  /** Return a canonical Readium Locator for the start of a page. */
  locatorForPage(index: number): ComicPageLocator;
}
