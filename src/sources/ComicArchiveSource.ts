import { NitroModules } from 'react-native-nitro-modules';

import type {
  Locator,
  PageBox,
  PageSource,
  ProgressionDirection,
  SpreadIntent,
  SpreadSlot,
} from '../types';
import type { ComicArchiveSource as NativeComicArchiveSource } from '../../nitro/ComicArchiveSource.nitro';

/**
 * JavaScript wrapper around the native CBZ/CBR reader.
 *
 * The underlying C++ implementation owns the ZIP handle, parses
 * ComicInfo.xml, sorts pages naturally, and returns encoded image bytes.
 */
export class ComicArchiveSource implements PageSource {
  private native: NativeComicArchiveSource;
  private _pageCount = 0;
  private _progressionDirection: ProgressionDirection = 'ltr';
  private _spreadIntent: SpreadIntent = 'auto';

  constructor() {
    this.native = NitroModules.createHybridObject<NativeComicArchiveSource>(
      'ComicArchiveSource',
    );
  }

  async open(path: string): Promise<void> {
    await this.native.open(path);
    this._pageCount = this.native.pageCount;
    this._progressionDirection = this.native.progressionDirection;
    this._spreadIntent = this.native.spreadIntent;
  }

  close(): void {
    this.native.close();
  }

  get pageCount(): number {
    return this._pageCount;
  }

  get spreadIntent(): SpreadIntent {
    return this._spreadIntent;
  }

  get progressionDirection(): ProgressionDirection {
    return this._progressionDirection;
  }

  layoutOf(): 'fixed' {
    return 'fixed';
  }

  spreadSlotOf(index: number): SpreadSlot {
    return this.native.getSpreadSlot(index);
  }

  getPageBox(index: number): PageBox {
    return this.native.getPageBox(index);
  }

  locatorForPage(index: number): Locator {
    return this.native.locatorForPage(index);
  }

  pageForLocator(loc: Locator): number {
    const progression = loc.locations?.progression ?? 0;
    if (this._pageCount === 0) return 0;
    const idx = Math.floor(progression * this._pageCount);
    return Math.max(0, Math.min(this._pageCount - 1, idx));
  }

  readEntryBytes(index: number): Promise<ArrayBuffer> {
    return this.native.readEntryBytes(index);
  }
}
