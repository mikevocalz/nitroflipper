# Updating the pinned MuPDF

The pin lives in `third_party/mupdf/CMakeLists.txt` and nowhere else. Every
platform build, the host tests, the CI cache key and the release-check workflow
read it from there through `scripts/mupdf-pin.sh`.

Current pin:

| | |
| --- | --- |
| Version | 1.28.4, released 2026-09-15 |
| SHA256 | `2d97e043a616f96b148657c9c3d81ad71c4bd2052c59a2a3315ad842599340f9` |
| Upstream tag | `ce933bdebe05fe54ba9d69792ed268efd9e00047` |
| URL | `https://mupdf.com/downloads/archive/mupdf-1.28.4-source.tar.gz` |

## Why this is a manual procedure

`.github/workflows/mupdf-update.yml` watches
<https://mupdf.com/releases/history> and <https://mupdf.com/security> weekly and
opens an issue when a newer release appears. It downloads nothing and changes
nothing.

That split is deliberate. MuPDF is AGPL-3.0 or an Artifex commercial licence —
never MIT, whatever `package.json` says about NitroFlipper itself — and it is
statically linked into every consumer's app. An automated "bump to latest" would
change the licensed code inside shipped binaries without anyone reading the
release notes. It would also break quietly: 1.28.4 has no `FZ_ERROR_MEMORY`, and
`fz_convert_error` is the call the engine's error path depends on. Both are
things you find in `CHANGES`, not in a green build.

So the automation's output is a version + hash bump a person reviews, and the
fixtures and the native gates re-run underneath it.

## Procedure

### 1. Read `CHANGES` before touching anything

Download the new tarball by hand, or let step 3 fetch it, then read `CHANGES`
from the pinned version up to the new one. What matters:

- Removed or renamed `fz_*` / `pdf_*` functions. `cpp/mupdf/` calls about thirty
  of them; `FzGuard.cpp`, `FzHandles.h` and `MuPDFDocument.cpp` are the files to
  grep against the list.
- Changes to the `FZ_ERROR_*` enum. `FzGuard.cpp` maps those values onto the
  engine's error classes, and a reordered enum compiles silently.
- Anything about `fz_style_document`, `fz_make_bookmark` or `fz_lookup_bookmark`.
  The relayout-anchor behaviour in `MuPDFDocument` is built on those three.
- New or removed `FZ_ENABLE_*` flags, which have to be mirrored in
  `MUPDF_FEATURE_DEFS` and in the thirdparty selection.

### 2. Get the new SHA256

```bash
curl -fsSL -o mupdf-<version>-source.tar.gz \
  "https://mupdf.com/downloads/archive/mupdf-<version>-source.tar.gz"
shasum -a 256 mupdf-<version>-source.tar.gz
```

Record the upstream tag too. Artifex's release page names it; it goes in the
comment above `MUPDF_UPSTREAM_TAG` so a source tree can be traced back to a git
commit rather than only to a tarball.

### 3. Bump the pin

In `third_party/mupdf/CMakeLists.txt`, change three values and the comment that
names the tag:

```cmake
set(MUPDF_VERSION "<version>" CACHE STRING "Pinned MuPDF release")
set(MUPDF_URL_SHA256 "<sha256>")
set(MUPDF_UPSTREAM_TAG "<tag>")
```

Check the parser still agrees:

```bash
scripts/mupdf-pin.sh all
```

Then fetch and verify:

```bash
TREE=$(scripts/fetch-mupdf.sh ~/.cache/nitroflipper-mupdf)
```

`fetch-mupdf.sh` fails on a hash mismatch and deletes the tarball rather than
leaving a bad one for the next run to trust. It also fails if
`generated/resources/fonts/urw` is empty, which is what a git checkout looks
like — the release tarball pre-generates the urw base-14 fonts and only those.
Everything else is generated at CMake configure time by `scripts/hexdump.sh`.

### 4. Regenerate the source list

```bash
python3 third_party/mupdf/extract_sources.py "$TREE" \
  third_party/mupdf/mupdf_sources.cmake
git diff third_party/mupdf/mupdf_sources.cmake
```

The script parses upstream's `Makelists`, so a file that appeared or vanished
shows up as a diff line instead of a link error. It also stats every path it
emits and fails if one is missing.

Review the diff for:

- Files added under a group we compile. They come along automatically, which is
  the point, but a new thirdparty subsystem can mean a new flag to set.
- Files removed. Harmless, except where the removal is a whole feature that
  `MUPDF_FEATURE_DEFS` still enables.
- A group that lost all its files, which means upstream renamed the `*_SRC`
  variable and `WANTED` in `extract_sources.py` needs the new name.

Against 1.28.4 the script emits 254 thirdparty sources across 9 groups and
reproduces the committed file byte for byte.

### 5. Re-run the engine tests against the real fixtures

```bash
cmake -S . -B build-mupdf -DCMAKE_BUILD_TYPE=Release \
  -DNITROFLIPPER_WITH_MUPDF=ON -DMUPDF_SOURCE_DIR="$TREE"
npm run test:mupdf
```

Seeding `MUPDF_SOURCE_DIR` into the CMake cache once is enough; `npm run
test:mupdf` reconfigures the same directory and keeps the value, so it will not
download its own copy.

These run against `fixtures/output/comic.pdf` and `comic.epub`, not synthetic
data. The cases that matter most on an upgrade are the locator round-trip
(`a locator survives a relayout at a different font size`), the error-mapping
cases, and the executor teardown cases.

### 6. Rebuild both platforms

Android:

```bash
cd example/android
./gradlew :nitro-flipper:assembleRelease -PreactNativeArchitectures=arm64-v8a
cd ../..
scripts/check-android-aar.sh
```

`check-android-aar.sh` asserts every `LOAD` segment is `0x4000`-aligned, so the
library still loads on a 16 KB-page device, and prints the `.so` size. Record
that size: the MuPDF engine is most of the binary, and a jump means a feature
flag or the font set moved.

iOS:

```bash
MUPDF_SOURCE_DIR="$TREE" scripts/build-mupdf-apple.sh
```

Both slices have to appear under `ios/generated/mupdf.xcframework` —
`ios-arm64` and `ios-arm64_x86_64-simulator`. They are separate because device
and simulator are both arm64 and cannot share a fat static library.

### 7. Update the documentation that carries version numbers

- `docs/licensing.md` — the version, release date, SHA256 and tag in
  "What this package contains", and the thirdparty licence table if the source
  list gained or lost a library.
- `docs/adr/0001-mupdf-bindings.md` — the "Pinned MuPDF" line.
- `docs/mupdf-integration-status.md` — re-measure. Do not copy the old numbers
  forward.
- This file's table at the top.

### 8. Close the loop

Reference the tracking issue the workflow opened and paste the real numbers into
it: test counts, `.so` size, xcframework slices. The issue's checklist is the
same list as this section.

## What the release-check workflow actually does

`scripts/check-mupdf-release.mjs` fetches both pages with no dependencies beyond
Node builtins and reports:

- every `1.x.y` version listed on the history page, and which of them are newer
  than the pin;
- whether the pinned version is still listed at all — if it is not, the script
  exits non-zero, because the pin then points at something Artifex withdrew or
  the page changed shape;
- a SHA256 digest of the security page's text, compared against
  `.github/mupdf-security-baseline.txt` when that file exists, plus any
  `CVE-...` identifiers on the page.

Run it locally the same way CI does:

```bash
node scripts/check-mupdf-release.mjs
```

It exits non-zero if it parses no versions out of the history page, so a layout
change upstream fails loudly instead of reporting "no newer release" forever.

### The security baseline

`.github/mupdf-security-baseline.txt` holds the SHA256 of the security page's
text as of the last time a person read it. When the page changes, the workflow
opens an issue titled `MuPDF security page changed (<first 12 of the digest>)`
even if no new release exists.

Resolving that issue means reading the page and writing the new digest into that
file in the same commit. Leaving it stale files the same issue every Monday:

```bash
node scripts/check-mupdf-release.mjs | \
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).security.digest))' \
  > .github/mupdf-security-baseline.txt
```
