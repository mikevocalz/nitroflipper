import { NitroModules } from 'react-native-nitro-modules';

export * from './types';
export * from './pagination/Paginator';
export * from './pagination/FixedPaginator';
export * from './pagination/ReflowablePaginator';
export * from './pagination/PagePairing';
export * from './pagination/PositionResolver';
export * from './pagination/SpreadPolicy';

export * from './sources/ComicArchiveSource';
export * from './renderer';

export type { PageCurlSolver } from '../nitro/PageCurlSolver.nitro';
export type { ComicArchiveSource } from '../nitro/ComicArchiveSource.nitro';
export * from '../nitro/FlipperTypes';

export function createPageCurlSolver(): import('../nitro/PageCurlSolver.nitro').PageCurlSolver {
  return NitroModules.createHybridObject<import('../nitro/PageCurlSolver.nitro').PageCurlSolver>(
    'PageCurlSolver',
  );
}

export function createComicArchiveSource(): import('./sources/ComicArchiveSource').ComicArchiveSource {
  return new (require('./sources/ComicArchiveSource').ComicArchiveSource)();
}
