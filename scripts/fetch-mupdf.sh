#!/usr/bin/env bash
#
# Download, verify and extract the pinned MuPDF release tarball.
#
#   scripts/fetch-mupdf.sh [cache-dir]
#
# Prints the path of the extracted tree on stdout (everything else goes to
# stderr) so a caller can do:
#
#   MUPDF_SOURCE_DIR=$(scripts/fetch-mupdf.sh "$RUNNER_TEMP/mupdf")
#   cmake -S . -B build -DMUPDF_SOURCE_DIR="$MUPDF_SOURCE_DIR" ...
#
# Why this exists rather than letting FetchContent do it: the tarball is 66MB
# and the extracted tree is where CMake writes the fonts it generates with
# scripts/hexdump.sh at configure time. Caching this one directory therefore
# saves both the download and the font generation, and passing MUPDF_SOURCE_DIR
# makes every target in the repo -- host tests, Android, the Apple xcframework
# -- share the same tree instead of each re-downloading into its own _deps.
#
# The SHA256 is checked on every run, including on a cache hit, so a poisoned
# or truncated cache entry fails here instead of producing a mystery build
# error later.
#
# LICENSING: this downloads MuPDF, which is AGPL-3.0 / Artifex commercial and
# is not covered by NitroFlipper's MIT licence. See docs/licensing.md.

set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${1:-$PACKAGE_ROOT/.mupdf-cache}"

eval "$("$PACKAGE_ROOT/scripts/mupdf-pin.sh" all)"

TARBALL="$CACHE_DIR/mupdf-${MUPDF_VERSION}-source.tar.gz"
TREE="$CACHE_DIR/mupdf-${MUPDF_VERSION}-source"

mkdir -p "$CACHE_DIR"

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    echo "error: neither shasum nor sha256sum found" >&2
    exit 1
  fi
}

if [ ! -f "$TARBALL" ]; then
  echo "==> downloading $MUPDF_URL" >&2
  curl -fsSL --retry 3 --retry-delay 5 -o "$TARBALL.part" "$MUPDF_URL"
  mv "$TARBALL.part" "$TARBALL"
fi

ACTUAL=$(sha256_of "$TARBALL")
if [ "$ACTUAL" != "$MUPDF_URL_SHA256" ]; then
  echo "error: SHA256 mismatch for $TARBALL" >&2
  echo "  expected $MUPDF_URL_SHA256" >&2
  echo "  actual   $ACTUAL" >&2
  # Do not leave a bad tarball behind for the next run to trust.
  rm -f "$TARBALL"
  exit 1
fi
echo "==> SHA256 ok: $MUPDF_URL_SHA256" >&2

if [ ! -f "$TREE/include/mupdf/fitz.h" ]; then
  echo "==> extracting into $CACHE_DIR" >&2
  rm -rf "$TREE"
  tar -xzf "$TARBALL" -C "$CACHE_DIR"
fi

if [ ! -f "$TREE/include/mupdf/fitz.h" ]; then
  echo "error: $TREE has no include/mupdf/fitz.h after extraction" >&2
  exit 1
fi

# Sanity-check the one thing the CMake file hard-fails on: the tarball is
# supposed to ship the urw fonts pre-generated. A git checkout does not, and
# the resulting error is much clearer here than three minutes into a build.
URW_COUNT=$(find "$TREE/generated/resources/fonts/urw" -name '*.c' 2>/dev/null | wc -l | tr -d ' ')
if [ "$URW_COUNT" -eq 0 ]; then
  echo "error: no pre-generated urw fonts in $TREE/generated/resources/fonts/urw" >&2
  echo "       this looks like a git checkout rather than a -source tarball" >&2
  exit 1
fi
echo "==> urw fonts pre-generated: $URW_COUNT files" >&2

echo "$TREE"
