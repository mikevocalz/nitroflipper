# ADR-0002: One document, one thread, shared-pointer job ownership

Status: accepted
Date: 2026-09-16

## Context

MuPDF's threading rules are specific and easy to misread. A `fz_context` is
cheap and may be cloned per thread. A `fz_document` is not safe for simultaneous
access, and cloning the context does **not** make it so. Robin Watts' guidance
is that parallel rendering means: prepare a display list under exclusive
document access, then rasterise that list on another thread with its own cloned
context.

The reader also has to survive the JS side dropping a HybridObject while a
render is in flight, and a close arriving between a job being queued and running.

## Decision

`DocumentExecutor` owns one `MuPDFDocument` and one worker thread. Every
operation — open, layout, render, search, close — goes through its queue.

Three rules fall out of that:

1. **The engine does not lock internally.** A per-call lock would make each call
   atomic while still letting a render observe a half-applied relayout. The
   serialization has to be at the operation level, so it lives in the executor.

2. **Jobs capture `shared_ptr`, never raw `this`.** `submit()` captures
   `shared_from_this()`, so the document outlives any work queued against it
   even if JS releases its handle mid-render. `cancellationToken()` deliberately
   captures a `weak_ptr` instead, because the token can outlive the executor
   while a search unwinds.

3. **A job re-checks cancellation when it runs.** Checking only at submit time
   leaves a window: shutdown can arrive after the job is queued, and running it
   then would call into a document `close()` has already released. The check at
   the top of the job body closes that window.

Every path settles its promise. Work submitted after shutdown is rejected with
`Cancelled` immediately rather than left pending — an unsettled promise is a
reader stuck on a spinner with no way out.

## Not yet done

Parallel rendering. The display-list split is the documented way to get it and
the engine is shaped to allow it later (`renderPixmap` is already the only place
that touches a page). It is not implemented, and until profiling on real
hardware says the single worker is the bottleneck, it should not be.

## Consequences

- A long search blocks subsequent renders until it yields. Mitigated by polling
  the cancellation token once per page rather than once per chapter.
- Two readers on screen means two executors and two threads. That is the
  intended design: `MuPDFDocument` holds its own `fz_context`, so they cannot
  disturb each other — which is also why per-document CSS matters (ADR-0004).
- Tests cover teardown with eight renders in flight, submit-after-shutdown, and
  destruction while a job holds the executor alive.
