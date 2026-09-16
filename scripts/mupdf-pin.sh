#!/usr/bin/env bash
#
# Print the pinned MuPDF coordinates that third_party/mupdf/CMakeLists.txt
# declares. One parser, used by the CI cache key, the fetch script and the
# release-check workflow, so none of them can drift from the CMake file.
#
#   scripts/mupdf-pin.sh            # shell-eval'able assignments
#   scripts/mupdf-pin.sh version    # 1.28.4
#   scripts/mupdf-pin.sh sha256     # 2d97e04...
#   scripts/mupdf-pin.sh tag        # ce933bd...
#   scripts/mupdf-pin.sh url        # https://mupdf.com/downloads/archive/...
#
# The SHA256 assignment spans two lines in the CMake file, so the whole file is
# flattened before matching rather than read line by line.

set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CMAKE_FILE="$PACKAGE_ROOT/third_party/mupdf/CMakeLists.txt"

if [ ! -f "$CMAKE_FILE" ]; then
  echo "error: $CMAKE_FILE not found" >&2
  exit 1
fi

FLAT=$(tr '\n' ' ' < "$CMAKE_FILE")

extract() { # $1 = cmake variable name
  local value
  value=$(printf '%s' "$FLAT" |
    grep -oE "set\\( *$1 +\"[^\"]+\"" |
    head -1 |
    sed -E 's/.*"([^"]+)"/\1/')
  if [ -z "$value" ]; then
    echo "error: $1 not found in $CMAKE_FILE" >&2
    exit 1
  fi
  printf '%s' "$value"
}

MUPDF_VERSION=$(extract MUPDF_VERSION)
MUPDF_URL_SHA256=$(extract MUPDF_URL_SHA256)
MUPDF_UPSTREAM_TAG=$(extract MUPDF_UPSTREAM_TAG)
MUPDF_URL="https://mupdf.com/downloads/archive/mupdf-${MUPDF_VERSION}-source.tar.gz"

case "${1:-all}" in
  version) echo "$MUPDF_VERSION" ;;
  sha256)  echo "$MUPDF_URL_SHA256" ;;
  tag)     echo "$MUPDF_UPSTREAM_TAG" ;;
  url)     echo "$MUPDF_URL" ;;
  all)
    echo "MUPDF_VERSION=$MUPDF_VERSION"
    echo "MUPDF_URL_SHA256=$MUPDF_URL_SHA256"
    echo "MUPDF_UPSTREAM_TAG=$MUPDF_UPSTREAM_TAG"
    echo "MUPDF_URL=$MUPDF_URL"
    ;;
  *)
    echo "usage: $(basename "$0") [version|sha256|tag|url|all]" >&2
    exit 2
    ;;
esac
