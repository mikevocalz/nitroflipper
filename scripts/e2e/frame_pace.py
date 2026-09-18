#!/usr/bin/env python3
"""
How often the reader's surface actually reaches the screen, from SurfaceFlinger.

`dumpsys gfxinfo` cannot see a Skia canvas on the SurfaceView path, and
`screenrecord` drops frames of its own on a panel this size. The compositor's
own present timestamps are the only honest measure of whether a curl is
running at the panel's rate.

    python3 scripts/e2e/frame_pace.py --serial 913949703467 --turns 3
"""

from __future__ import annotations

import argparse
import re
import math
import shlex
import statistics
import subprocess
import sys
import time

VSYNC_SLACK = 1.4  # a gap longer than this many vsyncs is a dropped frame


def window_frame(serial: str, package: str) -> tuple[int, int, int, int]:
    """
    The app window's size, not the display's.

    `wm size` reports the panel -- on a dual-screen it keeps saying 2700x1800
    while the app is folded onto one screen at 1350x1800, and a swipe computed
    from that starts outside the window and never reaches the reader.
    """
    out = adb(serial, "shell", "dumpsys", "window", "windows")
    block = out.split(package)
    for chunk in block[1:]:
        found = re.search(r"frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]", chunk)
        if found:
            x0, y0, x1, y1 = (int(v) for v in found.groups())
            if x1 > x0 and y1 > y0:
                return x0, y0, x1 - x0, y1 - y0
    size = adb(serial, "shell", "wm", "size").strip().splitlines()[-1]
    width, height = (int(v) for v in size.split(":")[-1].strip().split("x"))
    return 0, 0, width, height


def adb(serial: str, *args: str) -> str:
    # exec-out, not shell: a pty wraps long lines, and SurfaceFlinger layer
    # names are long enough to be split in half by it.
    mode = "exec-out" if args and args[0] == "shell" else args[0]
    rest = args[1:] if args and args[0] == "shell" else args[1:]
    return subprocess.run(
        ["adb", "-s", serial, mode, *rest], capture_output=True, check=True
    ).stdout.decode("utf-8", "replace")


def surface_layer(serial: str, package: str) -> str:
    listing = adb(serial, "shell", "dumpsys", "SurfaceFlinger", "--list")
    candidates = [line.strip() for line in listing.splitlines()
                  if "BLAST" in line and "SurfaceView" in line and package in line]
    if len(candidates) == 1:
        return candidates[0]
    raise SystemExit(f"expected one canvas SurfaceView, found {len(candidates)}; "
                     "choose its exact SurfaceFlinger name with --layer")


def present_times(serial: str, layer: str) -> tuple[float, list[int]]:
    out = adb(serial, "shell", f"dumpsys SurfaceFlinger --latency {shlex.quote(layer)}")
    rows = [r.split() for r in out.splitlines() if r.strip()]
    if not rows:
        raise SystemExit("no latency data; the layer name may have changed")
    vsync_ms = int(rows[0][0]) / 1e6
    if vsync_ms <= 0:
        raise SystemExit("no refresh interval; is the display active?")
    frames = []
    for row in rows[1:]:
        if len(row) != 3:
            continue
        try:
            present = int(row[1])
        except ValueError:
            continue
        # A pending frame reads as 0 or INT64_MAX; neither is a present time.
        if present in (0, 9223372036854775807):
            continue
        frames.append(present)
    return vsync_ms, sorted(set(frames))


def frame_gaps(frames: list[int]) -> list[float]:
    """Keep every gap inside a turn, including stalls longer than 400 ms."""
    ordered = sorted(set(frames))
    return [(b - a) / 1e6 for a, b in zip(ordered, ordered[1:])]


def percentile(values: list[float], fraction: float) -> float:
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def pacing_passes(gaps: list[float], vsync_ms: float,
                  max_missed_pct: float, max_gap_ms: float) -> bool:
    if not gaps or vsync_ms <= 0:
        return False
    missed = sum(g > vsync_ms * VSYNC_SLACK for g in gaps)
    return (percentile(gaps, 0.95) <= vsync_ms * VSYNC_SLACK
            and 100 * missed / len(gaps) <= max_missed_pct
            and max(gaps) <= max_gap_ms)


def run(args) -> int:
    layer = args.layer or surface_layer(args.serial, args.package)
    x0, y0, width, height = window_frame(args.serial, args.package)
    all_gaps: list[float] = []
    total_frames = 0
    passed = True
    print(f"layer      {layer}")
    for turn in range(args.turns):
        # A read does not drain SurfaceFlinger. Explicitly exclude its history,
        # and sample each turn before the rolling buffer loses earlier turns.
        vsync_ms, before = present_times(args.serial, layer)
        baseline = max(before, default=0)
        if args.tap:
            x, y = (float(v) for v in args.tap.split(","))
            adb(args.serial, "shell", "input", "tap",
                str(x0 + int(width * x)), str(y0 + int(height * y)))
        else:
            adb(args.serial, "shell", "input", "swipe",
                str(x0 + int(width * 0.92)), str(y0 + height // 2),
                str(x0 + int(width * 0.08)), str(y0 + height // 2), str(args.swipe_ms))
        time.sleep(args.settle)
        vsync_ms, after = present_times(args.serial, layer)
        frames = [timestamp for timestamp in after if timestamp > baseline]
        gaps = frame_gaps(frames)
        all_gaps.extend(gaps)
        total_frames += len(frames)
        # No inter-turn gap enters this sample. No within-turn gap is removed.
        # A snap or an ignored gesture must not pass on one attractive median.
        complete = args.min_frames <= len(frames) < 127
        good = complete and pacing_passes(gaps, vsync_ms,
                                         args.max_missed_pct, args.max_gap_ms)
        passed = passed and good
        peak = max(gaps, default=0)
        print(f"turn {turn + 1:>3}   {len(frames)} frames, max {peak:.1f}ms: "
              f"{'PASS' if good else 'FAIL'}")
        if len(frames) >= 127:
            print("           latency buffer may have wrapped; sample is incomplete")
    if not all_gaps:
        print("no frame intervals -- did the input reach a ready page turn?")
        return 1
    missed = sum(g > vsync_ms * VSYNC_SLACK for g in all_gaps)
    median = statistics.median(all_gaps)
    print(f"vsync      {vsync_ms:.1f}ms ({1000 / vsync_ms:.0f}Hz panel)")
    print(f"frames     {total_frames} presented over {args.turns} turns")
    print(f"gap p50    {median:.1f}ms -> {1000 / median:.0f}fps")
    print(f"gap p95    {percentile(all_gaps, 0.95):.1f}ms")
    print(f"gap max    {max(all_gaps):.1f}ms")
    print(f"late gaps  {missed}/{len(all_gaps)} ({100 * missed / len(all_gaps):.1f}%)")
    return 0 if passed else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--serial", required=True)
    p.add_argument("--package", default="com.example")
    p.add_argument("--turns", type=int, default=3)
    p.add_argument("--swipe-ms", type=int, default=220)
    p.add_argument("--tap", help="turn via a tap at normalized 'x,y' instead")
    p.add_argument("--settle", type=float, default=1.2)
    p.add_argument("--layer", help="exact canvas SurfaceView name from SurfaceFlinger --list")
    p.add_argument("--min-frames", type=int, default=8)
    p.add_argument("--max-missed-pct", type=float, default=5)
    p.add_argument("--max-gap-ms", type=float, default=50)
    args = p.parse_args()
    if args.turns < 1 or args.min_frames < 2 or args.settle <= 0:
        p.error("turns must be positive, min-frames >= 2, and settle > 0")
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
