# NitroFlipper project notes

## Decisions

- Package name: `nitro-flipper`
- Repo layout: single package with `src/`, `cpp/`, `nitro/`, `ios/`, `android/`, `example/`.
- React Native target: `0.86.3` (minimum for react-native-gesture-handler v3 + New Architecture).
- CBZ is the primary page source. PDF/EPUB fixtures are generated; full
  `PageSource` implementations for those formats are still TODO.

## Build / test

```bash
# Everything (typecheck, C++ unit tests, TS round-trip tests)
npm test

# C++ solver + comic archive tests
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --target pagecurlsolver_test --target comicarchive_test
./build/pagecurlsolver_test
./build/comicarchive_test

# TypeScript gate
npm run typecheck
```

## Regenerate synthetic fixtures

```bash
python3 fixtures/generate_comic.py
```

## Phase status

- Phase 0: decided.
- Phase 1: `PageCurlSolver` C++ core implemented with Catch2 golden-file tests.
- Phase 2: `PositionResolver` + paginators implemented; fixed and reflowable
  single→spread→single round-trips pass at three font sizes.
- Phase 3: Nitrogen codegen for `PageCurlSolver` and `ComicArchiveSource`; C++
  `HybridObject` wrappers added; `tsc --noEmit` green.
- Phase 4: CBZ comic archive support via vendored miniz; synthetic LTR/RTL CBZs,
  PDF, and EPUB fixtures generated and tested.
- Phase 5+: not started.

## References

- Cone deformation math: W. Dana Nuon,
  "Implementing iBooks page curling using a conical deformation algorithm"
  (http://wdnuon.blogspot.com/2010/05/implementing-ibooks-page-curling-using.html)
- Reference TypeScript implementation: Philip Rideout, pageturn
  (https://github.com/prideout/pageturn)
