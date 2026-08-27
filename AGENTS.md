# NitroFlipper project notes

## Decisions

- Package name: `nitro-flipper`
- Repo layout: single package with `src/`, `cpp/`, `nitro/`, `ios/`, `android/`, `example/`.
- React Native target: `0.86.3` (minimum for react-native-gesture-handler v3 + New Architecture).

## Build / test

```bash
# C++ solver + golden-file tests
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --target pagecurlsolver_test
./build/pagecurlsolver_test

# TypeScript gate (to be exercised once src/ exists)
npm run typecheck
```

## Phase status

- Phase 0: decided.
- Phase 1: `PageCurlSolver` C++ core implemented with Catch2 golden-file tests.
- Phase 2: `PositionResolver` + paginators implemented; fixed and reflowable
  single→spread→single round-trips pass at three font sizes.
- Phase 3+: not started.

## References

- Cone deformation math: W. Dana Nuon,
  "Implementing iBooks page curling using a conical deformation algorithm"
  (http://wdnuon.blogspot.com/2010/05/implementing-ibooks-page-curling-using.html)
- Reference TypeScript implementation: Philip Rideout, pageturn
  (https://github.com/prideout/pageturn)
