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
python3 scripts/e2e/frame_pace.py --serial <adb-serial> --turns 6 --idle-ms 120
```

Reads present timestamps straight from SurfaceFlinger, because neither
alternative is honest here: `dumpsys gfxinfo` cannot see a Skia canvas on the
SurfaceView path, and `screenrecord` drops frames of its own on a panel this
size. Exit status is non-zero when the median gap is worse than the panel's
vsync.

`adb shell input swipe` emits only a handful of move events, so a swipe-driven
run partly measures the input generator. To see the animation's own cadence,
turn the page through the page control instead:

```bash
python3 scripts/e2e/frame_pace.py --serial <adb-serial> --tap 0.559,0.933
```

## Measured on a Surface Duo (spanned, 2700x1800, 60Hz panel)

| | before | after |
|---|---|---|
| page decode (`readPageScaled`) | 2331ms | 399ms |
| first spread on screen | 4581ms | 824ms |
| frames presented per turn | 8 | ~21 |
| median frame gap | 33.3ms (30fps) | 16.7ms (60fps) |
| blank landings, 34-turn soak | 3 | 0 |
