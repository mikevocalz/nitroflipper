# CI and packaging

What the workflows do, what `npm pack` actually produces, and which of the
claims below were measured rather than reasoned about.

Everything marked **measured** was run on the machine described at the bottom of
this file. Everything marked **unverified** has never executed. Most of that is
"has not run on a GitHub runner yet", and it is called out per job rather than
buried.

## Workflows

### `.github/workflows/ci.yml`

| Job | Runner | What it gates |
| --- | --- | --- |
| `typecheck` | ubuntu-latest | `npm run typecheck` |
| `test-ts` | ubuntu-latest | `npm run test:ts` |
| `test-cpp` | ubuntu-latest | `npm run test:cpp` — solver, archive, scaler. No MuPDF, no `npm install`. |
| `test-mupdf` | ubuntu-latest | `npm run test:mupdf` against the real PDF and EPUB fixtures, with the MuPDF tree restored from cache |
| `android` | ubuntu-latest | `:nitro-flipper:assembleRelease` through the example app's Gradle root, then `scripts/check-android-aar.sh` |
| `ios` | macos-15 | `scripts/build-mupdf-apple.sh`, both xcframework slices, then `pod install` in `example/ios` |
| `pack` | ubuntu-latest | `scripts/verify-pack.sh`, then a MuPDF configure driven from the extracted tarball |

No job uses `continue-on-error`. The `test-cpp` job deliberately skips
`npm install`: those three targets are plain C++ with committed fixtures, so the
fastest gate in the matrix has no Node dependency to break.

### The MuPDF cache

Three jobs share one cache entry shape:

```
key: mupdf-${{ runner.os }}-<MUPDF_URL_SHA256>-${{ hashFiles('third_party/mupdf/CMakeLists.txt', 'third_party/mupdf/mupdf_sources.cmake') }}
path: .mupdf-cache
```

`scripts/mupdf-pin.sh` parses the SHA256 out of the CMake file, so bumping the
pin invalidates the cache by construction. There is no second place to remember
to edit. The two CMake files are in the key as well, because the fonts CMake
generates with `scripts/hexdump.sh` at configure time are written into that same
tree and saved with it. Changing `NITROFLIPPER_MUPDF_FONTS` or the source
selection therefore gets a fresh tree instead of a half-generated one.

`scripts/fetch-mupdf.sh` re-verifies the SHA256 on every run, cache hit included,
and deletes the tarball on a mismatch rather than leaving a poisoned entry.

The cache holds the source tree and the generated fonts. It does not hold object
files: a stale object cache that silently serves the previous build is exactly
the kind of green-but-wrong this repo should not have.

### `.github/workflows/mupdf-update.yml`

Weekly (Mondays 07:00 UTC) plus manual dispatch.
`scripts/check-mupdf-release.mjs` reads <https://mupdf.com/releases/history> and
<https://mupdf.com/security>, compares them against the pin, and the workflow
opens, or comments on, an issue labelled `mupdf-update` carrying the checklist
from [`docs/mupdf-update.md`](mupdf-update.md).

`.github/mupdf-security-baseline.txt` records the SHA256 of the security page's
text as of the last human read, so a change to that page raises an issue even
when no new release exists. Refreshing it is part of resolving that issue; the
command is in [`docs/mupdf-update.md`](mupdf-update.md#the-security-baseline).

It never downloads a tarball and never edits the pin. MuPDF is AGPL-3.0 or an
Artifex commercial licence, it is statically linked into every consumer's app,
and releases remove API the engine calls. The upgrade is a reviewed version +
hash bump that re-runs the fixtures and the native gates; see
[`docs/licensing.md`](licensing.md) before shipping anything built from it.

## `npm pack`

### The tarball as it stands

**Measured**, `scripts/verify-pack.sh`:

```
tarball:  nitro-flipper-0.0.1.tgz
size:     361693 bytes (361.7 kB)
files:    163
unpacked: 2068 kB
```

The byte count moves with every source edit; the file count and the shape below
are the parts to compare against.

Top level:

| Path | Files |
| --- | --- |
| `lib` | 50 (`.js` + `.d.ts`, produced by the `prepack` script) |
| `nitrogen/generated` | 41 |
| `cpp` | 29, of which `cpp/mupdf` 7 and `cpp/vendor` 5 |
| `src` | 17 |
| `nitro` | 8 |
| `scripts` | 6 |
| `android` | 5 |
| `third_party/mupdf` | 3 |
| `docs/licensing.md`, `package.json`, `NitroFlipper.podspec`, `react-native.config.js` | 1 each |

Every path the deliverable asked about is present: `src`, `cpp` including
`cpp/mupdf`, `nitro`, `nitrogen/generated`, `third_party/mupdf`, `android`,
`NitroFlipper.podspec`, `react-native.config.js`.

### What was wrong, and what changed

**`files` dragged in 4 GB of local build output.** npm's `files` array is an
allowlist that `.gitignore` cannot subtract from. Verified against npm 11.19.1
with a three-file probe package: a directory named in `files` is packed whole,
`.gitignore` notwithstanding. The entries `"android"` and `"ios"` therefore
covered, on this machine:

| Path | Files | Size | Tracked in git |
| --- | --- | --- | --- |
| `android/.cxx` | 26,786 | 2.5 GB | 0 |
| `android/build` | 1,666 | 1.4 GB | 0 |
| `android/.gradle` | 13 | 52 KB | 0 |
| `ios/generated/mupdf.xcframework` | 171 | 87 MB | 0 |

`npm pack --dry-run` on the unfixed `files` array ran for over eight minutes at
100% CPU without finishing, which is how this was noticed. Fixed by adding
negations, which npm-packlist does honour inside the `files` array, also
verified on the probe package:

```json
"android", "!android/build", "!android/.cxx", "!android/.gradle", "!android/.kotlin",
"ios",     "!ios/generated"
```

`ios` is kept rather than deleted so that a future `ios/*.mm` ships without
anyone remembering to re-add it. It currently contributes no files.

**`scripts/` was missing and the podspec needs it.** `NitroFlipper.podspec` sets
`s.prepare_command = "bash scripts/build-mupdf-apple.sh"`. That directory was not
in `files`, so `pod install` from a published tarball would have failed on a
missing script before it built anything. Added.

**`docs/licensing.md` was missing and three shipped files point at it.** The
podspec, `android/CMakeLists.txt` and `third_party/mupdf/CMakeLists.txt` all say
"see docs/licensing.md" in the comment next to the code that links AGPL-licensed
MuPDF into the consumer's binary. In the published package that pointer led
nowhere. Added.

**Nothing built `lib/`.** `main` and `module` point at `lib/index` and `types` at
`lib/index.d.ts`, `files` lists `lib`, and no script produced it before packing.
Added `"prepack": "npm run build"`. `prepack` rather than `prepare`, so `npm
install` in this repo and in `example/` does not start a `tsc` run.

### Still wrong, and deliberately left alone

`main`, `module` and `types` point at paths that do not exist in the tarball.
`tsconfig.json` includes both `src/` and `nitro/`, so TypeScript's common root
is the package root and `--outDir lib` emits `lib/src/index.js` and
`lib/nitro/…`, not `lib/index.js`:

```
lib/src/index.js
lib/src/index.d.ts
```

A consumer resolving `main` gets nothing. React Native apps are unaffected, because
Metro takes the `react-native` field, which is `src/index`, but any Node or
bundler path that honours `main` breaks. The fix is one of `main`/`types`
pointing at `lib/src/index`, or a `rootDir` in `tsconfig.json`. Both are outside
the file scope this task was given, so they are reported here rather than
changed.

There is no `README.md` and no `LICENSE` file at the package root, so npm's
automatic inclusion of those two finds nothing. For a package whose licensing
story needs stating up front, that is worth fixing before publishing.

## Clean-consumer smoke check

`scripts/verify-pack.sh` packs, extracts to a scratch directory, and checks
three things. **Measured**, all passing:

1. **Required paths.** 14 directories and 21 files, including `cpp/mupdf`,
   `cpp/vendor/miniz`, `cpp/vendor/stb`, both autolinking entry points and all
   three `third_party/mupdf` files.
2. **Forbidden paths.** `android/build`, `android/.cxx`, `android/.gradle`,
   `ios/generated`, `node_modules`, `example`, `build`, `build-mupdf`.
3. **Relative references.** Every `../`-prefixed path in
   `android/CMakeLists.txt` is extracted by grep and resolved against the
   extracted tree, so adding a source to the CMake without adding it to `files`
   fails the build that publishes it. The fixed paths named by
   `android/build.gradle`, the podspec and `react-native.config.js` are checked
   alongside. The podspec is parsed with `ruby -c` and
   `scripts/build-mupdf-apple.sh` with `bash -n`.

Beyond the script, **measured** from the extracted tarball:

```
cmake -S third_party/mupdf -B <tmp> -DMUPDF_SOURCE_DIR=<cached tree> -DCMAKE_BUILD_TYPE=Release
-- MuPDF: using local tree …/mupdf-1.28.4-source
-- MuPDF fonts: no-cjk (179 embedded files)
-- Configuring done (1.2s)
```

The shipped `third_party/mupdf` resolves `mupdf_sources.cmake` next to itself,
finds the pre-generated urw fonts and generates the other 164, all without the
repository.

### What a clean-consumer check cannot show without a real app

- **Gradle.** `android/build.gradle` reads `ndkVersion`, `compileSdkVersion`,
  `minSdkVersion`, `targetSdkVersion` and `reactNativeArchitectures` from
  `rootProject.ext`, which only exists inside a host app. The library cannot be
  configured standalone, so "the paths resolve" is as far as a tarball check
  goes. The `android` job covers the rest by building through `example/android`.
- **CocoaPods.** `pod install` resolves `install_modules_dependencies` and the
  React Native pod graph out of the consumer's `node_modules`, none of which is
  in the tarball. Path presence is checkable; resolution is not.
- **Runtime.** Nothing in the tarball has executed on a device or an emulator.

## Measured numbers

Host: macOS 27.0 (Darwin 26A428), Apple M3 Pro, 11 cores. Node 26.8.2,
npm 11.19.1, CMake 4.4.3, Python 3.13.3, Ruby 3.4.2, Zulu JDK 17.0.20.1,
Android NDK 27.1.12297006.

| Step | Result |
| --- | --- |
| `npm run typecheck` | clean, 1.2 s |
| `npm run test:ts` | 22 tests, 9 suites, 0 fail, 0.3 s |
| `npm run test:cpp` | 15 cases, 315 assertions, 0 fail, 3.7 s warm |
| MuPDF configure, cached tree | 3.2 s |
| MuPDF build, `-j11` | 1 m 07 s wall, 383 s CPU |
| `npm run test:mupdf` | 24 cases, **23 passed, 1 failed** — see below |
| `:nitro-flipper:assembleRelease` | BUILD SUCCESSFUL, 22 s warm, 61 tasks |
| `nitro-flipper-release.aar` | 11,091,984 bytes |
| `libNitroFlipper.so`, arm64-v8a | 19,405,816 bytes, 3 `LOAD` segments all `0x4000` |
| `scripts/build-mupdf-apple.sh` | both slices built; device `arm64`, simulator `x86_64 arm64`; 87 MB |
| `extract_sources.py` against 1.28.4 | 254 sources, 9 groups, byte-identical to the committed file |
| `node scripts/check-mupdf-release.mjs` | 70 releases parsed, latest `1.28.4` = pinned, `actionNeeded: false` |
| `scripts/verify-pack.sh` | 361,693 bytes, 163 files, all checks pass |

### The MuPDF suite is currently red

```
tests/MuPDFDocument.test.cpp:403
reflow.epub: bigger type in the same box means strictly more pages
  SIGABRT — libc++abi: terminating due to uncaught exception of type
  std::__1::system_error: thread::join failed: Resource deadlock avoided

test cases: 24 | 23 passed | 1 failed
assertions: 78 | 77 passed | 1 failed
```

This is in-flight work: `cpp/mupdf/MuPDFDocument.cpp`, `tests/MuPDFDocument.test.cpp`
and `fixtures/output/reflow.epub` are all modified or new in the working tree.
The `test-mupdf` job will fail on this until it is fixed, which is the correct
behaviour and is why the job carries no `continue-on-error`. It is recorded here
so nobody reads a red first run as a broken workflow.

Note also that `docs/mupdf-integration-status.md` records 23 cases / 77
assertions and an AAR of 10.54 MB with an 18.30 MB `.so`. The numbers above are
larger because the working tree has moved since. Re-measure rather than copying
either set forward.

## Not verified

- **No workflow has run on GitHub Actions.** Both files are clean under
  `actionlint` 1.7.7 with `shellcheck` 0.10.0 (which lints the `run:` blocks),
  and every command inside them was run by hand on this machine, but these
  runner-side pieces have not executed: cache hit and restore, `sdkmanager`
  installing the NDK, `ruby/setup-ruby`, artifact upload, `gh issue create`.
- **Linux.** Every native build measured here was macOS + Apple clang. The
  `test-cpp`, `test-mupdf` and `android` jobs run on `ubuntu-latest` with GCC.
  Nothing in `cpp/` or `third_party/mupdf/CMakeLists.txt` is Apple-specific, but
  a first Linux compile has not happened.
- **`pod install`.** Never run, here or anywhere: `docs/mupdf-integration-status.md`
  says so and the local CocoaPods install is broken (`Ignoring ffi-1.16.3 because
  its extensions are not built`). The `ios` job runs it, and its first CI run is
  a genuine experiment rather than a regression check. The steps up to it, the
  xcframework build and both slices, were measured.
- **The AAR gate's failure path.** `scripts/check-android-aar.sh` was confirmed
  to parse 3 real `LOAD` segments at `0x4000`, and it fails loudly if it parses
  none, but no 4 KB-aligned library was built to watch it reject one.
- **The `mupdf-update` issue path.** The checker was exercised both ways against
  the live pages: no-newer-release against the real pin, and 20 newer releases
  against a temporarily faked `1.26.0` pin, with `GITHUB_OUTPUT` written
  correctly in both. The `gh label create` / `gh issue create` steps that consume
  those outputs have not run.
- **Android caching.** The `android` job does not share the MuPDF cache. The
  library's MuPDF arrives through `FetchContent` inside the AGP build, which puts
  it under `android/.cxx`. That is 2.5 GB on this machine, past what a GitHub
  cache entry is worth. Teaching `android/build.gradle` to forward `MUPDF_SOURCE_DIR`
  through `externalNativeBuild.cmake.arguments` would let that job reuse the same
  entry the other three do. `android/build.gradle` was outside this task's file
  scope.

## Running the checks locally

```bash
npm run typecheck
npm run test:ts
npm run test:cpp

TREE=$(scripts/fetch-mupdf.sh ~/.cache/nitroflipper-mupdf)
cmake -S . -B build-mupdf -DCMAKE_BUILD_TYPE=Release \
  -DNITROFLIPPER_WITH_MUPDF=ON -DMUPDF_SOURCE_DIR="$TREE"
npm run test:mupdf

(cd example/android && ./gradlew :nitro-flipper:assembleRelease -PreactNativeArchitectures=arm64-v8a)
scripts/check-android-aar.sh

MUPDF_SOURCE_DIR="$TREE" scripts/build-mupdf-apple.sh

scripts/verify-pack.sh
node scripts/check-mupdf-release.mjs
```
