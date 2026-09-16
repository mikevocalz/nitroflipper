#!/bin/bash
#
# Build MuPDF for Apple platforms and package it as an xcframework.
#
# MuPDF removed its iOS Makefile sections in 1.26, so there is no upstream
# target to call. This drives the package's own CMake once per slice and lets
# xcodebuild assemble the result, which is also the only way to ship device and
# simulator arm64 together -- they are the same architecture and cannot coexist
# in a fat static library.
#
# Run from the package root, or let the podspec's prepare_command run it.
#
#   ./scripts/build-mupdf-apple.sh [output-dir]
#
# Skips the whole build when the xcframework is already present and newer than
# the CMake inputs, so `pod install` is not a five-minute operation every time.

set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-$PACKAGE_ROOT/ios/generated}"
XCFRAMEWORK="$OUTPUT_DIR/mupdf.xcframework"
BUILD_ROOT="$PACKAGE_ROOT/build/apple"

DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-15.1}"
FONTS="${NITROFLIPPER_MUPDF_FONTS:-no-cjk}"

if ! command -v cmake >/dev/null 2>&1; then
  echo "error: cmake not found. brew install cmake" >&2
  exit 1
fi

# Rebuild only when an input is newer than the output. `find -newer` on the two
# files that actually determine the build keeps this honest without a full
# dependency graph.
if [ -d "$XCFRAMEWORK" ]; then
  NEWER=$(find "$PACKAGE_ROOT/third_party/mupdf/CMakeLists.txt" \
               "$PACKAGE_ROOT/third_party/mupdf/mupdf_sources.cmake" \
               -newer "$XCFRAMEWORK/Info.plist" 2>/dev/null | head -1 || true)
  if [ -z "$NEWER" ]; then
    echo "mupdf.xcframework is up to date"
    exit 0
  fi
  echo "MuPDF build inputs changed; rebuilding"
  rm -rf "$XCFRAMEWORK"
fi

# device:  arm64, real hardware
# sim:     arm64 + x86_64, so Apple Silicon and Intel Macs both run the sim
build_slice() {
  local name="$1" sysroot="$2" archs="$3"
  local dir="$BUILD_ROOT/$name"

  echo "==> MuPDF for $name ($archs)"
  cmake -S "$PACKAGE_ROOT/third_party/mupdf" -B "$dir" -G "Unix Makefiles" \
    -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_ARCHITECTURES="$archs" \
    -DCMAKE_OSX_SYSROOT="$sysroot" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET" \
    -DCMAKE_BUILD_TYPE=Release \
    -DNITROFLIPPER_MUPDF_FONTS="$FONTS" \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    ${MUPDF_SOURCE_DIR:+-DMUPDF_SOURCE_DIR=$MUPDF_SOURCE_DIR} \
    > "$dir.configure.log" 2>&1 || { cat "$dir.configure.log" >&2; exit 1; }

  cmake --build "$dir" --target mupdf -j"$(sysctl -n hw.ncpu)" \
    > "$dir.build.log" 2>&1 || { tail -40 "$dir.build.log" >&2; exit 1; }

  # mupdf and mupdf_thirdparty are separate archives; an xcframework slice
  # takes one library, so merge them.
  libtool -static -o "$dir/libmupdf-combined.a" \
    "$dir/libmupdf.a" "$dir/libmupdf_thirdparty.a" 2>/dev/null
}

mkdir -p "$BUILD_ROOT" "$OUTPUT_DIR"
build_slice device iphoneos "arm64"
build_slice simulator iphonesimulator "arm64;x86_64"

# The headers are the same for every slice.
HEADER_STAGE="$BUILD_ROOT/headers"
rm -rf "$HEADER_STAGE"
mkdir -p "$HEADER_STAGE"
# Either a local tree was pointed at, or FetchContent put one under _deps.
# MUPDF_SOURCE_DIR is a cache entry only when it was passed in, so check both
# rather than assuming either.
MUPDF_SRC="${MUPDF_SOURCE_DIR:-}"
if [ -z "$MUPDF_SRC" ] || [ ! -d "$MUPDF_SRC/include" ]; then
  MUPDF_SRC=$(sed -n 's/^MUPDF_SOURCE_DIR:[A-Z]*=//p' \
    "$BUILD_ROOT/device/CMakeCache.txt" 2>/dev/null | head -1)
fi
if [ -z "$MUPDF_SRC" ] || [ ! -d "$MUPDF_SRC/include" ]; then
  MUPDF_SRC="$BUILD_ROOT/device/_deps/mupdf-src"
fi
if [ ! -d "$MUPDF_SRC/include" ]; then
  echo "error: cannot find MuPDF headers (looked in $MUPDF_SRC/include)" >&2
  exit 1
fi
cp -R "$MUPDF_SRC/include/"* "$HEADER_STAGE/"

xcodebuild -create-xcframework \
  -library "$BUILD_ROOT/device/libmupdf-combined.a" -headers "$HEADER_STAGE" \
  -library "$BUILD_ROOT/simulator/libmupdf-combined.a" -headers "$HEADER_STAGE" \
  -output "$XCFRAMEWORK" > "$BUILD_ROOT/xcframework.log" 2>&1 \
  || { cat "$BUILD_ROOT/xcframework.log" >&2; exit 1; }

echo "==> $XCFRAMEWORK"
du -sh "$XCFRAMEWORK"
