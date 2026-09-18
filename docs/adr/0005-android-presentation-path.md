# ADR-0005: The Android presentation path for the page curl

Status: accepted

Date: 2026-09-17

## Context

The page turn presented a new frame every other vsync on a Surface Duo
(2700x1800, one logical display, 60.000004 Hz, presentation deadline
16666666 ns, Android 14 / SDK 34). The animation was being produced at the
panel's rate and shown at half it.

Four explanations were measured and three of them were wrong, so they are
written down here to stop them being re-proposed.

**Not fill rate.** Shading fewer pixels did reach 60fps, and cost tracked pixel
count closely enough to be convincing. It was an artefact: a smaller
SurfaceView is cheaper for the compositor. Rendering at 0.65 scale and
upscaling bought the frame rate and visibly softened every page (max channel
delta 118 against 35 for the change that was kept), for a cause that was not
fill rate at all.

**Not the shader, and not the work in it.** Halving the curl's per-pixel
sampling took frame work from 7.38ms to 4.56ms at p50 without moving the
presented cadence. Removing the per-frame paint allocation took work p90 from
7.28ms to 5.32ms, also without moving it. Both are real reductions in work and
neither touched the number that matters.

**Not decode.** Turns with four seconds of idle between them, with staging
certain to have finished, measured no better than turns 1.4s apart.

**Not the app being late.** 83% of the app's frames report
`on_time_finish = 1` while 60.4% report `Late Present`. The app finishes
inside its deadline and is shown late anyway.

## Decision

The canvas is not `opaque`. That prop picks the Android view behind it: opaque
is a SurfaceView with a compositor layer of its own, non-opaque is a
TextureView that HWUI draws as an ordinary quad inside the app's window. At
matched resolution the SurfaceView path presented 18 frames over four turns
against the TextureView path's 49, p50 32.97ms against 16.68ms.

## Why the turn still doubles

The cause is buffer stuffing in the app window's own queue, and the trace says
so without ambiguity.

The queue has exactly three slots -- `setMaxDequeuedBufferCount(2)` and
`setMaxAcquiredBufferCount(1)`, set once at launch, with slot indices {0,1,2}
handed out round-robin. Queue depth at the moment the producer asks for a
buffer predicts the outcome with no exceptions: depth 3 blocks for 10-21ms
(20 occurrences), depth 2 or less returns in under 0.09ms (9 occurrences).

One event starts it. SurfaceFlinger display frame 19720611 missed its GPU
deadline -- 32.03ms, two whole vsync periods, `gpu_composition = 1` -- starting
1.93ms before the first long block. That single late present took the depth
from 2 to 3, and it never came back down. Every one of the nineteen app frames
after it finishes on time and is still presented about 12ms late, tagged
`Buffer Stuffing`.

While blocked the render thread is in `S`, an interruptible userspace wait, and
is woken by a binder transaction from SurfaceFlinger's main thread delivering
`releasePendingBuffer` for the layer -- 0.77 to 1.56ms before it resumes, with
monotonically increasing frame numbers, on all twenty occasions. Actual
drawing during those frames is about 1.3ms of a 16.6ms budget: the render
thread spends roughly 92% of each frame asleep waiting for a slot.

Two plausible alternatives were excluded rather than argued away. It is not a
GPU fence: the only fence work inside each block is a
`HWC release fence has signaled` check of about 1 microsecond, roughly 20
microseconds of fence against 305ms of blocking, and a fence wait would show as
`D` state, which never appears. It is not the Skia canvas: React Native Skia
presents from the main thread into its own SurfaceTexture, and across every
producer slice on that thread there is exactly zero overlap with a blocked
dequeue -- they land at least 25ms before the stuffed run or 737ms after it.

The layer is GPU client-composited every frame (`RenderEngine DrawLayer`,
`composeSurfaces` averaging 3.0ms) rather than being handed to a hardware
overlay, which is what puts SurfaceFlinger's GPU deadline on the critical path
in the first place.

## Consequences

Work that reduces per-frame cost in the app -- shader, allocations, mapper
topology -- cannot fix this, and three such changes have now demonstrated that
by measuring flat. The trigger is a compositor deadline miss and the mechanism
is a three-slot queue that cannot recover from one.

Giving the queue more headroom is not available. `BLASTBufferQueue`'s
constructor sets `setMaxDequeuedBufferCount(2)` as a literal, takes the
acquired count from SurfaceFlinger over binder, and calls
`setDequeueTimeout(int64 max)`, so the wait never expires. There is no app-
reachable setter -- `android.graphics.BLASTBufferQueue` and `ViewRootImpl` are
hidden and the NDK exposes no equivalent. That leaves stopping the layer being
client-composited, or skipping a present so the queue drains by itself.

Making the window opaque is the cheap version of the first, and the theme is
what prevents it: `windowTranslucentStatus` and `windowTranslucentNavigation`
force the window format to translucent. Removing them does make the layer
report `isOpaque=true`. It also costs the reader its full height -- the page
art stops at the system bars -- because those flags are what make the window
draw behind them, whatever `setDecorFitsSystemWindows(false)` suggests. So this
has to come with the insets handled on the React side, not as a theme edit, and
is not done.

A note on measuring the next attempt: the layout shift moved the page control,
and turns driven by fixed tap coordinates silently stopped turning pages while
still producing a plausible-looking trace. Take coordinates from the element
tree, and check the page label actually advanced before reading any cadence
number.

Two things this trace cannot answer, each needing a source this device does not
register: why that SurfaceFlinger frame missed its GPU deadline needs
`gpu.renderstages` and vendor GPU counters, and why the layer never gets an
overlay needs the composer HAL's per-layer composition-change reasons.

FrameTimeline is the instrument, and it cannot see SurfaceViews. It measures
this canvas only because the canvas is non-opaque. Putting `opaque` back would
silently stop it measuring the thing it is pointed at.
