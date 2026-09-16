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
import statistics
import subprocess
import sys
import time

VSYNC_SLACK = 1.4  # a gap longer than this many vsyncs is a dropped frame


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
    for line in listing.splitlines():
        if "BLAST" in line and package in line:
            return line.strip()
    raise SystemExit(f"no BLAST layer for {package}; is the canvas opaque?")


def present_times(serial: str, layer: str) -> tuple[float, list[int]]:
    out = adb(serial, "shell", f"dumpsys SurfaceFlinger --latency '{layer}'")
    rows = [r.split() for r in out.splitlines() if r.strip()]
    if not rows:
        raise SystemExit("no latency data; the layer name may have changed")
    vsync_ms = int(rows[0][0]) / 1e6
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
    return vsync_ms, sorted(frames)


def run(args) -> int:
    layer = surface_layer(args.serial, args.package)
    width, height = (
        int(v)
        for v in adb(args.serial, "shell", "wm", "size").split(":")[-1].strip().split("x")
    )
    present_times(args.serial, layer)  # drain whatever came before

    for _ in range(args.turns):
        if args.tap:
            # A tap on the page control runs the same curl with no touch
            # stream behind it, which is the only way to see the animation's
            # own cadence: `input swipe` emits a handful of move events, so a
            # drag measured this way is really measuring the input generator.
            x, y = (float(v) for v in args.tap.split(","))
            adb(args.serial, "shell", "input", "tap",
                str(int(width * x)), str(int(height * y)))
        else:
            adb(
                args.serial, "shell", "input", "swipe",
                str(int(width * 0.92)), str(height // 2),
                str(int(width * 0.08)), str(height // 2), str(args.swipe_ms),
            )
        time.sleep(args.settle)

    vsync_ms, frames = present_times(args.serial, layer)
    gaps = [
        (b - a) / 1e6
        for a, b in zip(frames, frames[1:])
        if 0 < (b - a) / 1e6 < args.idle_ms
    ]
    if not gaps:
        print("no frames presented -- did the swipe land on the reader?")
        return 1

    dropped = sum(1 for g in gaps if g > vsync_ms * VSYNC_SLACK)
    median = statistics.median(gaps)
    print(f"layer      {layer}")
    print(f"vsync      {vsync_ms:.1f}ms ({1000 / vsync_ms:.0f}Hz panel)")
    print(f"frames     {len(frames)} presented over {args.turns} turns")
    print(f"gap p50    {median:.1f}ms -> {1000 / median:.0f}fps")
    print(f"gap p90    {statistics.quantiles(gaps, n=10)[8]:.1f}ms")
    print(f"gap max    {max(gaps):.1f}ms")
    print(f"dropped    {dropped}/{len(gaps)} ({100 * dropped / len(gaps):.0f}%)")
    # A turn that holds the panel's rate is the bar; anything else is visible.
    return 0 if median <= vsync_ms * VSYNC_SLACK else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--serial", required=True)
    p.add_argument("--package", default="com.example")
    p.add_argument("--turns", type=int, default=3)
    p.add_argument("--swipe-ms", type=int, default=220)
    p.add_argument("--tap", help="turn via a tap at normalized 'x,y' instead")
    p.add_argument("--settle", type=float, default=1.2)
    p.add_argument("--idle-ms", type=float, default=400, help="gap that means idle")
    return run(p.parse_args())


if __name__ == "__main__":
    sys.exit(main())
