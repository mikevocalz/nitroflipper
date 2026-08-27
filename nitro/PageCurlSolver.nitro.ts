import type { HybridObject } from 'react-native-nitro-modules';
import type { Config, Frame } from './FlipperTypes';

/**
 * Synchronous Nitro HybridObject wrapping the C++ page-curl solver.
 *
 * Create via:
 *   NitroModules.createHybridObject<PageCurlSolver>("PageCurlSolver")
 */
export interface PageCurlSolver
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** Configure the solver for a given page size and mesh density. */
  init(pageWidth: number, pageHeight: number, config: Config): void;

  /** Hit-test a touch as a legal curl start (UI-thread safe). */
  beginGrab(x: number, y: number): boolean;

  /** Update the deformation from a finger drag. */
  updateGrab(x: number, y: number): void;

  /** Release with velocity; C++ decides commit vs. snap-back. */
  release(vx: number, vy: number): void;

  /** Advance the release animation and return the current frame. */
  tick(dt: number): Frame;
}
