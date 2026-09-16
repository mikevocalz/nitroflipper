#!/usr/bin/env bash
#
# Gate the Android release AAR on the two things that are cheap to check and
# expensive to discover on a device.
#
#   scripts/check-android-aar.sh [path/to/nitro-flipper-release.aar]
#
#   1. libNitroFlipper.so is present for every ABI the build asked for.
#   2. Every LOAD segment is aligned to 0x4000, so the library loads on a
#      16 KB-page device. Android 15+ ships 16 KB-page devices and a 4 KB-aligned
#      .so fails to load there with a dynamic-linker error that names nothing
#      useful. android/build.gradle passes
#      -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON for this; the check is here so a
#      toolchain or flag change cannot silently undo it.
#
# Sizes are printed because the MuPDF engine is most of the binary and a jump
# in that number is the first sign that a feature flag or the font set moved.

set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AAR="${1:-$PACKAGE_ROOT/android/build/outputs/aar/nitro-flipper-release.aar}"

if [ ! -f "$AAR" ]; then
  echo "error: no AAR at $AAR" >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
unzip -q "$AAR" -d "$WORK"

# Not `mapfile`: macOS still ships bash 3.2 and this script has to run there as
# well as on a Linux runner.
LIBS=()
while IFS= read -r lib; do
  LIBS+=("$lib")
done < <(find "$WORK/jni" -name 'libNitroFlipper.so' 2>/dev/null | sort)

if [ "${#LIBS[@]}" -eq 0 ]; then
  echo "error: $AAR contains no libNitroFlipper.so under jni/" >&2
  echo "       contents:" >&2
  find "$WORK" -maxdepth 2 >&2
  exit 1
fi

# readelf comes with binutils on Linux runners; llvm-readelf ships with the NDK
# and with Xcode's toolchain on macOS.
READELF=""
if command -v readelf >/dev/null 2>&1; then
  READELF=readelf
elif command -v llvm-readelf >/dev/null 2>&1; then
  READELF=llvm-readelf
else
  # macOS has neither, so fall back to the one inside the NDK. NDK_HOME first,
  # then any NDK under the SDK -- on a developer machine the SDK path is the
  # only one reliably set.
  for ndk in "${ANDROID_NDK_HOME:-}" "${ANDROID_NDK_ROOT:-}" \
             "${ANDROID_HOME:-}"/ndk/* "${ANDROID_SDK_ROOT:-}"/ndk/*; do
    if [ -z "$ndk" ] || [ ! -d "$ndk" ]; then
      continue
    fi
    for candidate in "$ndk"/toolchains/llvm/prebuilt/*/bin/llvm-readelf; do
      if [ -x "$candidate" ]; then
        READELF="$candidate"
        break 2
      fi
    done
  done
fi

if [ -z "$READELF" ]; then
  echo "error: no readelf or llvm-readelf found; cannot check page alignment." >&2
  echo "       Install binutils, or set ANDROID_NDK_HOME / ANDROID_HOME." >&2
  exit 1
fi

FAILURES=0
echo "AAR: $AAR ($(wc -c < "$AAR" | tr -d ' ') bytes)"

for lib in "${LIBS[@]}"; do
  abi=$(basename "$(dirname "$lib")")
  size=$(wc -c < "$lib" | tr -d ' ')
  echo
  echo "  $abi  libNitroFlipper.so  $size bytes"

  # `readelf -lW` prints LOAD lines whose last column is the alignment. Anything
  # under 0x4000 is a 4 KB-page build.
  bad=0
  seen=0
  while read -r align; do
    [ -n "$align" ] || continue
    seen=$((seen + 1))
    dec=$((align))
    if [ "$dec" -lt 16384 ]; then
      echo "    LOAD segment aligned $align (< 0x4000)" >&2
      bad=$((bad + 1))
    fi
  done < <("$READELF" -lW "$lib" | awk '$1 == "LOAD" { print $NF }')

  # Zero LOAD segments means the parse missed, not that the library is fine.
  # Without this a readelf output change turns the whole gate into a pass.
  if [ "$seen" -eq 0 ]; then
    echo "    FAIL: parsed no LOAD segments out of $READELF -lW" >&2
    FAILURES=$((FAILURES + 1))
    continue
  fi

  if [ "$bad" -gt 0 ]; then
    echo "    FAIL: $bad LOAD segment(s) not 16 KB-aligned" >&2
    FAILURES=$((FAILURES + 1))
  else
    echo "    16 KB page alignment: OK"
  fi
done

if [ "$FAILURES" -gt 0 ]; then
  echo >&2
  echo "FAILED: $FAILURES ABI(s) would not load on a 16 KB-page device" >&2
  exit 1
fi
echo
echo "OK: ${#LIBS[@]} ABI(s) checked"
