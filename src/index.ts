import { NitroModules } from 'react-native-nitro-modules';

export * from './types';
export * from './pagination/Paginator';
export * from './pagination/FixedPaginator';
export * from './pagination/ReflowablePaginator';
export * from './pagination/PagePairing';
export * from './pagination/PositionResolver';
export * from './pagination/SpreadPolicy';

export type { PageCurlSolver } from '../nitro/PageCurlSolver.nitro';
export * from '../nitro/FlipperTypes';

export const pageCurlSolver = NitroModules.createHybridObject<import('../nitro/PageCurlSolver.nitro').PageCurlSolver>(
  'PageCurlSolver',
);
