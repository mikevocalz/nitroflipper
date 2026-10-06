#!/usr/bin/env bash
#
# Pack the package, extract it somewhere clean, and check that everything a
# consumer's build reaches for is actually in there.
#
#   scripts/verify-pack.sh [work-dir]
#
# Three classes of check:
#
#   1. Required paths. The directories and files an Android Gradle build and a
#      CocoaPods install need. A missing one is a published-and-broken package.
#   2. Forbidden paths. Local build output that `files` used to drag in --
#      android/.cxx and ios/generated are 2.5GB and 87MB of machine-specific
#      artifacts. See docs/ci.md.
#   3. Relative references. Every `../` path in android/CMakeLists.txt, plus the
#      fixed set of paths android/build.gradle, the podspec and
#      react-native.config.js name, resolved against the extracted tree. This
#      is the check that catches someone adding a source file to the CMake and
#      forgetting the `files` entry.
#
# Prints the tarball size and file count at the end, which is what docs/ci.md
# records.

set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${1:-$(mktemp -d)}"
mkdir -p "$WORK_DIR"

FAILURES=0
fail() { echo "MISSING/WRONG: $*" >&2; FAILURES=$((FAILURES + 1)); }

echo "==> npm pack into $WORK_DIR"
TARBALL_NAME=$(cd "$PACKAGE_ROOT" && npm pack --pack-destination "$WORK_DIR" --silent | tail -1)
TARBALL="$WORK_DIR/$TARBALL_NAME"
[ -f "$TARBALL" ] || { echo "error: npm pack produced no $TARBALL" >&2; exit 1; }

EXTRACT="$WORK_DIR/extracted"
rm -rf "$EXTRACT"
mkdir -p "$EXTRACT"
tar -xzf "$TARBALL" -C "$EXTRACT"
PKG="$EXTRACT/package"
[ -d "$PKG" ] || { echo "error: tarball has no package/ root" >&2; exit 1; }

# --- 1. required paths -------------------------------------------------------

REQUIRED_DIRS=(
  src
  cpp
  cpp/mupdf
  cpp/vendor/miniz
  cpp/vendor/stb
  nitro
  nitrogen/generated
  nitrogen/generated/shared/c++
  nitrogen/generated/android
  nitrogen/generated/ios
  third_party/mupdf
  android
  android/src/main
  scripts
)

REQUIRED_FILES=(
  package.json
  NitroFlipper.podspec
  react-native.config.js
  android/build.gradle
  android/CMakeLists.txt
  android/cpp-adapter.cpp
  android/src/main/AndroidManifest.xml
  nitrogen/generated/android/NitroFlipper+autolinking.cmake
  nitrogen/generated/android/NitroFlipper+autolinking.gradle
  nitrogen/generated/ios/NitroFlipper+autolinking.rb
  third_party/mupdf/CMakeLists.txt
  third_party/mupdf/mupdf_sources.cmake
  third_party/mupdf/extract_sources.py
  scripts/build-mupdf-apple.sh
  scripts/mupdf-pin.sh
  scripts/fetch-mupdf.sh
  # MuPDF is AGPL-3.0 / Artifex commercial and NitroFlipper is MIT. Three
  # shipped files tell the reader to go and read this one, so it has to be in
  # the tarball for that pointer to lead anywhere.
  docs/licensing.md
  src/index.ts
  cpp/mupdf/MuPDFDocument.cpp
  cpp/mupdf/FzGuard.cpp
  cpp/vendor/miniz/miniz.c
)

echo "==> required paths"
for d in "${REQUIRED_DIRS[@]}"; do
  [ -d "$PKG/$d" ] || fail "directory $d"
done
for f in "${REQUIRED_FILES[@]}"; do
  [ -f "$PKG/$f" ] || fail "file $f"
done

# --- 2. forbidden paths ------------------------------------------------------

FORBIDDEN=(
  android/build
  android/.cxx
  android/.gradle
  ios/generated
  node_modules
  example
  build
  build-mupdf
)

echo "==> forbidden paths"
for p in "${FORBIDDEN[@]}"; do
  if [ -e "$PKG/$p" ]; then
    fail "$p is in the tarball and should not be"
  fi
done

# --- 3. relative references --------------------------------------------------

echo "==> relative references from android/CMakeLists.txt"
# Every ../-prefixed path the CMake file names, deduplicated. Quoted and bare
# forms both appear, so strip quotes before resolving.
while read -r ref; do
  [ -n "$ref" ] || continue
  resolved="$PKG/android/$ref"
  if [ ! -e "$resolved" ]; then
    fail "android/CMakeLists.txt references $ref, not in the tarball"
  fi
done < <(grep -oE '\.\./[A-Za-z0-9_./+-]+' "$PKG/android/CMakeLists.txt" | sort -u)

echo "==> fixed references from build.gradle, the podspec and react-native.config.js"
# Read off those three files by hand; each is a path the consumer's build
# resolves at configure time.
FIXED_REFS=(
  "android/../nitrogen/generated/android/NitroFlipper+autolinking.gradle"
  "nitrogen/generated/ios/NitroFlipper+autolinking.rb"
  "scripts/build-mupdf-apple.sh"
  "cpp"
  "cpp/mupdf"
  "cpp/vendor/miniz"
  "cpp/vendor/stb"
  "android/CMakeLists.txt"
  "NitroFlipper.podspec"
)
for ref in "${FIXED_REFS[@]}"; do
  [ -e "$PKG/$ref" ] || fail "$ref"
done

# The podspec's prepare_command shells out to this; an unset executable bit in
# the tarball is survivable (it is invoked as `bash scripts/...`) but a missing
# file is not.
if [ -f "$PKG/scripts/build-mupdf-apple.sh" ]; then
  bash -n "$PKG/scripts/build-mupdf-apple.sh" || fail "scripts/build-mupdf-apple.sh is not valid bash"
fi
if [ -f "$PKG/NitroFlipper.podspec" ] && command -v ruby >/dev/null 2>&1; then
  (cd "$PKG" && ruby -c NitroFlipper.podspec >/dev/null) || fail "NitroFlipper.podspec is not valid ruby"
fi

# --- 4. entry points ---------------------------------------------------------

# The fields a consumer's resolver actually reads. `main` pointed at
# `lib/index` for a while when tsc was emitting `lib/src/index.js` -- Metro
# never noticed, because it takes `react-native` first, so the package looked
# fine from the example app and broke for everyone else.
echo "==> package.json entry points resolve"
while read -r field value; do
  [ -n "$value" ] && [ "$value" != "null" ] || continue
  resolved=""
  for candidate in "$value" "$value.js" "$value.ts" "$value/index.js" "$value/index.ts"; do
    if [ -f "$PKG/$candidate" ]; then resolved="$candidate"; break; fi
  done
  if [ -z "$resolved" ]; then
    fail "package.json \"$field\": \"$value\" does not resolve in the tarball"
  fi
done < <(node -e '
  const p = require("'"$PKG"'/package.json");
  for (const f of ["main", "module", "types", "react-native", "source"]) {
    if (p[f]) console.log(f, p[f]);
  }
')

# --- report ------------------------------------------------------------------

BYTES=$(wc -c < "$TARBALL" | tr -d ' ')
COUNT=$(tar tzf "$TARBALL" | grep -vc '/$' || true)
UNPACKED=$(du -sk "$PKG" | cut -f1)

echo
echo "tarball:  $TARBALL_NAME"
echo "size:     $BYTES bytes ($(echo "$BYTES" | awk '{printf "%.1f kB", $1/1000}'))"
echo "files:    $COUNT"
echo "unpacked: ${UNPACKED} kB"
echo "extracted at: $PKG"

if [ "$FAILURES" -gt 0 ]; then
  echo
  echo "FAILED: $FAILURES packaging problem(s)" >&2
  exit 1
fi
echo "OK"
