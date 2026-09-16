import { NitroModules } from 'react-native-nitro-modules';

export * from './types';
export * from './pagination/Paginator';
export * from './pagination/FixedPaginator';
export * from './pagination/ReflowablePaginator';
export * from './pagination/PagePairing';
export * from './pagination/PositionResolver';
export * from './pagination/SpreadPolicy';

export * from './sources/ComicArchiveSource';
export * from './sources/MuPDFSource';
export * from './renderer';

export type { PageCurlSolver } from '../nitro/PageCurlSolver.nitro';
export type { ComicArchiveSource } from '../nitro/ComicArchiveSource.nitro';
export type { MuPDFFactory } from '../nitro/MuPDFFactory.nitro';
export type { MuPDFDocument } from '../nitro/MuPDFDocument.nitro';
export type { RenderedPage } from '../nitro/RenderedPage.nitro';
export * from '../nitro/MuPDFTypes';
export * from '../nitro/FlipperTypes';

export function createPageCurlSolver(): import('../nitro/PageCurlSolver.nitro').PageCurlSolver {
  return NitroModules.createHybridObject<import('../nitro/PageCurlSolver.nitro').PageCurlSolver>(
    'PageCurlSolver',
  );
}

export function createComicArchiveSource(): import('./sources/ComicArchiveSource').ComicArchiveSource {
  return new (require('./sources/ComicArchiveSource').ComicArchiveSource)();
}
