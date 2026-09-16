#!/usr/bin/env python3
"""
Drive a real device through the whole book, both ways, and fail on a bad frame.

The unit tests cover pairing and texture lifetime in isolation. What they
cannot see is the thing users report: a page that comes back blank after
turning back and forth, or a turn that visibly hangs while a page decodes.
This walks the reader with real touch input, decodes what is actually on the
panel, and measures how long each turn takes to settle.

A page is "blank" here when its half of the panel has almost no variation --
a decoded comic page never does. Thresholds are deliberately loose: this is a
did-anything-render check, not a pixel diff.

    python3 scripts/e2e/page_turn_soak.py --serial 913949703467 --pages 22
"""

from __future__ import annotations

import argparse
import io
import json
import statistics
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

# A decoded page varies far more than this; flat colour varies far less.
BLANK_STDDEV = 6.0
# A turn that takes longer than this is the lag the reader complains about.
SETTLE_BUDGET_MS = 1200
# Frames this close are the same frame, so the turn has landed.
STABLE_DIFF = 1.5


def adb(serial: str, *args: str, binary: bool = False):
    out = subprocess.run(
        ["adb", "-s", serial, *args], capture_output=True, check=True
    ).stdout
    return out if binary else out.decode("utf-8", "replace")


def grab(serial: str, scale: int = 4) -> Image.Image:
    """One frame, downscaled. Full res costs ~0.4s per poll and buys nothing."""
    png = adb(serial, "exec-out", "screencap", "-p", binary=True)
    image = Image.open(io.BytesIO(png)).convert("L")
    return image.reduce(scale)


def halves(frame: Image.Image) -> tuple[Image.Image, Image.Image]:
    w, h = frame.size
    # Inset: the fold and the outer edges carry chrome and shadow, not page.
    inset_x, inset_y = int(w * 0.04), int(h * 0.08)
    mid = w // 2
    left = frame.crop((inset_x, inset_y, mid - inset_x, h - inset_y))
    right = frame.crop((mid + inset_x, inset_y, w - inset_x, h - inset_y))
    return left, right


def spread_of(frame: Image.Image) -> tuple[float, float]:
    left, right = halves(frame)
    return ImageStat.Stat(left).stddev[0], ImageStat.Stat(right).stddev[0]


def difference(a: Image.Image, b: Image.Image) -> float:
    """Mean absolute pixel difference. C-level: a poll costs no real time."""
    return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]


def settle(serial: str, timeout_ms: int = 6000) -> tuple[Image.Image, int]:
    """Wait for the panel to stop moving. Returns the landed frame and the wait."""
    started = time.monotonic()
    previous = grab(serial)
    while (time.monotonic() - started) * 1000 < timeout_ms:
        current = grab(serial)
        if difference(previous, current) < STABLE_DIFF:
            return current, int((time.monotonic() - started) * 1000)
        previous = current
    return previous, timeout_ms


def swipe(serial: str, width: int, height: int, forward: bool, ms: int = 220):
    """
    A turn starts on the leaf being turned.

    Forward drags the outer (right) leaf in toward the spine; back drags from
    the spine side outward. Starting on the wrong half sets the shader's `dir`
    the wrong way and the turn does nothing -- which is itself worth catching.
    """
    y = height // 2
    if forward:
        x1, x2 = int(width * 0.92), int(width * 0.08)
    else:
        x1, x2 = int(width * 0.08), int(width * 0.92)
    adb(serial, "shell", "input", "swipe", str(x1), str(y), str(x2), str(y), str(ms))


@dataclass
class Turn:
    index: int
    direction: str
    settle_ms: int
    left_stddev: float
    right_stddev: float
    blank: bool
    changed: bool


@dataclass
class Report:
    turns: list[Turn] = field(default_factory=list)
    memory: list[dict] = field(default_factory=list)

    @property
    def failures(self) -> list[Turn]:
        return [t for t in self.turns if t.blank or t.settle_ms > SETTLE_BUDGET_MS]


def set_display(serial: str, size: str | None):
    """
    Resize the display, which is how a fold reads to the app.

    Folding a Surface Duo from spanned to one screen is a configuration change:
    the window halves, the reader relayouts, and every cached texture is for
    the wrong raster. `wm size` produces the same change without hands.
    """
    if size is None:
        adb(serial, "shell", "wm", "size", "reset")
    else:
        adb(serial, "shell", "wm", "size", size)
    time.sleep(3)


def memory_sample(serial: str, package: str) -> dict:
    out = adb(serial, "shell", "dumpsys", "meminfo", package)
    sample = {}
    for line in out.splitlines():
        for label, key in (
            ("Native Heap:", "native_heap_kb"),
            ("Graphics:", "graphics_kb"),
            ("TOTAL PSS:", "total_pss_kb"),
        ):
            if label in line:
                digits = [int(p) for p in line.replace(":", " ").split() if p.isdigit()]
                if digits:
                    sample[key] = digits[0]
    return sample


def relaunch(serial: str, package: str, activity: str, settle_ms: int = 12000):
    """
    Start from a cold app, every time.

    A Metro reload tears the Skia surface down and it does not come back --
    the canvas goes black with no error in the log. A soak that reloaded
    instead of relaunching would be measuring that, not the reader.
    """
    adb(serial, "shell", "am", "force-stop", package)
    adb(serial, "shell", "am", "start", "-n", f"{package}/{activity}")
    time.sleep(settle_ms / 1000)


def run(args) -> int:
    serial, package = args.serial, args.package
    if not args.no_relaunch:
        relaunch(serial, package, args.activity)
    size = adb(serial, "shell", "wm", "size").strip().split(":")[-1].strip()
    width, height = (int(v) for v in size.split("x"))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    folded = False
    report = Report()
    frame, _ = settle(serial)
    previous_frame = frame
    report.memory.append({"at": "start", **memory_sample(serial, package)})

    # Forward through the whole book, then back through the whole book, then a
    # thrash over one boundary -- the sequence that used to come back blank.
    #
    # back-to-front runs the same walk from the other end: get to the last
    # spread, then read the book backwards. A reader who opens at their
    # furthest page and pages back exercises turns the forward walk never
    # does, and that is where a solo double-width page is.
    if args.mode == "back-to-front":
        plan = [("forward", i) for i in range(args.turns)] + [
            ("back", i) for i in range(args.turns + args.thrash)
        ]
    else:
        plan = (
            [("forward", i) for i in range(args.turns)]
            + [("back", i) for i in range(args.turns)]
            + [("forward", i) if i % 2 == 0 else ("back", i) for i in range(args.thrash)]
        )

    for n, (direction, _) in enumerate(plan):
        if args.fold_at is not None and n == args.fold_at:
            print(f"--- folding to {args.fold_size} ---", flush=True)
            folded = True
            set_display(serial, args.fold_size)
            width, height = (
                int(v)
                for v in adb(serial, "shell", "wm", "size")
                .strip()
                .splitlines()[-1]
                .split(":")[-1]
                .strip()
                .split("x")
            )
            frame, _ = settle(serial)
            left_sd, right_sd = spread_of(frame)
            folded_blank = left_sd < BLANK_STDDEV and right_sd < BLANK_STDDEV
            frame.save(out / "fold-transition.png")
            print(
                f"    after fold: {width}x{height} sd={left_sd:.2f}/{right_sd:.2f}"
                f"{' BLANK' if folded_blank else ''}",
                flush=True,
            )
            report.turns.append(
                Turn(-1, "fold", 0, round(left_sd, 2), round(right_sd, 2),
                     folded_blank, True)
            )
        swipe(serial, width, height, direction == "forward")
        frame, waited = settle(serial)
        left_sd, right_sd = spread_of(frame)
        # Folded, one page fills the screen and spans both halves of the
        # frame; spanned, each half is its own page. Either way a rendered
        # page varies -- but a page shown alone can letterbox one half, so
        # folded runs only require that SOMETHING rendered.
        blank = (
            (left_sd < BLANK_STDDEV and right_sd < BLANK_STDDEV)
            if folded
            else (left_sd < BLANK_STDDEV or right_sd < BLANK_STDDEV)
        )
        changed = difference(previous_frame, frame) > STABLE_DIFF
        report.turns.append(
            Turn(n, direction, waited, round(left_sd, 2), round(right_sd, 2), blank, changed)
        )
        if blank or waited > SETTLE_BUDGET_MS or args.save_all:
            frame.save(out / f"turn-{n:03d}-{direction}{'-BLANK' if blank else ''}.png")
        previous_frame = frame
        if n % 10 == 9:
            report.memory.append({"at": f"turn-{n}", **memory_sample(serial, package)})
        print(
            f"{n:3d} {direction:7s} settle={waited:5d}ms "
            f"sd={left_sd:6.2f}/{right_sd:6.2f} {'BLANK' if blank else ''}"
            f"{'' if changed else ' UNCHANGED'}",
            flush=True,
        )

    report.memory.append({"at": "end", **memory_sample(serial, package)})
    (out / "report.json").write_text(
        json.dumps(
            {"turns": [asdict(t) for t in report.turns], "memory": report.memory},
            indent=2,
        )
    )

    waits = [t.settle_ms for t in report.turns]
    print(
        f"\n{len(report.turns)} turns | settle p50={statistics.median(waits):.0f}ms "
        f"max={max(waits)}ms | blanks={sum(t.blank for t in report.turns)} "
        f"| unchanged={sum(not t.changed for t in report.turns)}"
    )
    return 1 if report.failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--package", default="com.example")
    parser.add_argument("--turns", type=int, default=10, help="turns each way")
    parser.add_argument("--thrash", type=int, default=10, help="alternating turns")
    parser.add_argument("--out", default="e2e-artifacts")
    parser.add_argument(
        "--mode", choices=("forward-back", "back-to-front"), default="forward-back"
    )
    parser.add_argument("--save-all", action="store_true", help="keep every landing")
    parser.add_argument(
        "--fold-at", type=int, help="turn index at which to resize the display"
    )
    parser.add_argument(
        "--fold-size", default="1350x1800", help="display size to fold to"
    )
    parser.add_argument("--activity", default=".MainActivity")
    parser.add_argument(
        "--no-relaunch", action="store_true", help="drive the app as it stands"
    )
    args = parser.parse_args()
    try:
        return run(args)
    finally:
        if args.fold_at is not None:
            set_display(args.serial, None)


if __name__ == "__main__":
    sys.exit(main())
