# Device end-to-end checks

Two scripts, both driving a real device over adb. They exist because the unit
tests cover pairing and texture lifetime in isolation and cannot see the two
things readers actually report: a page that comes back blank, and a turn that
does not look smooth.

Both need the example app installed and running on the device.

## Page turns: does every page render, both ways

```bash
python3 scripts/e2e/page_turn_soak.py --serial <adb-serial> --turns 12 --thrash 10
```

Walks the book forward, back, then alternates over one boundary. After each
turn it decodes the panel and checks that each half of the spread has real
variation -- a decoded comic page always does, a blank one does not. Exit
status is non-zero if any landing was blank or took longer than the settle
budget; failing frames are written to `--out` (default `e2e-artifacts/`).

Useful variants:

- `--mode back-to-front` -- run to the last spread, then read the book
  backwards. Back-turns walk pairings the forward walk never does.
- `--fold-at N --fold-size 1350x1800` -- resize the display mid-run, which is
  what a fold looks like to the app: the window halves, the reader relayouts
  from a spread to a single page, and every cached texture is for the wrong
  raster. The display is reset afterwards even if the run fails.
- `--save-all` -- keep every landing, not just the failures.

The settle times it prints include the cost of pulling and decoding a
screenshot per poll, which on a 2700x1800 panel is seconds. Read them as "did
this turn finish", not as turn latency; `frame_pace.py` measures the turn.

## Frame pacing: does the curl hold the panel's rate

```bash
python3 scripts/e2e/frame_pace.py --serial <adb-serial> --turns 6
```

Reads present timestamps straight from SurfaceFlinger, because neither
alternative is honest here: `dumpsys gfxinfo` cannot see a Skia canvas on the
SurfaceView path, and `screenrecord` drops frames of its own on a panel this
size. Each turn is sampled separately, excluding timestamps already present
before its input. Only gaps between turns are excluded; a 600 ms stall inside
a turn remains in the result. Reading latency data does not drain its history.

Every turn must have at least eight presented frames, p95 within 1.4 panel
intervals, at most 5% late intervals, and no interval over 50 ms. A good median
alone cannot pass. `--min-frames`, `--max-missed-pct`, and `--max-gap-ms` can set
an explicit device budget. A potentially wrapped latency buffer fails the run.
If multiple SurfaceView layers exist, select the canvas with `--layer`.

The observation window includes late texture updates after the animation,
which can conservatively fail the pacing budget. SurfaceFlinger timestamps
alone cannot distinguish those updates from a stalled animation, or measure
input-to-first-frame delay. Inspect failures on the device and use the landing
soak alongside this test. Neither test establishes that intermediate frames
are free of visual artifacts.

`adb shell input swipe` emits only a handful of move events, so a swipe-driven
run partly measures the input generator. To see the animation's own cadence,
turn the page through the page control instead:

```bash
python3 scripts/e2e/frame_pace.py --serial <adb-serial> --tap 0.559,0.933
```

## Earlier Surface Duo measurements (spanned, 2700x1800, 60Hz panel)

These predate the atomic paint handoff and the stricter pacing gate above.
They are historical results, not validation of the current renderer. The old
median-only gate filtered out long gaps and could pass a visibly stalled turn.

| | before | after |
|---|---|---|
| page decode (`readPageScaled`) | 2331ms | 399ms |
| first spread on screen | 4581ms | 824ms |
| frames presented per turn | 8 | ~21 |
| median frame gap | 33.3ms (30fps) | 16.7ms (60fps) |
| blank landings, 34-turn soak | 3 | 0 |

## Validating the paint handoff

`npm run test:ts` includes CPU Skia pixel tests for the production curl shader:
the end of a turn and its replacement flat page must match in both directions,
with LTR/RTL and transitions between single pages and spreads. Cache tests cover
images larger than the cache budget and replacement-frame lifetimes.
`python3 -m unittest discover -s scripts/e2e -p 'test_*.py'` checks the pacing gate.

Device acceptance remains necessary: use an optimized build, run both scripts
in single-screen and spanned modes, then exercise rapid reversals, cancelled
drags, first/last pages, and folds during a turn. Check intermediate frames for
blinks and confirm graphics memory plateaus over repeated laps. Record p95,
maximum gap and late-interval rate per turn, not just median FPS. Native paint
creation, cross-runtime resource ownership and SurfaceView presentation need
this device check even when CPU rendering tests pass.
