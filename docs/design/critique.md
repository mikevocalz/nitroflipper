# Critique — prioritised fixes

**Verdict: 🚨 Significant UX problems.**

Scope: the example reader as checked in — `example/App.tsx`,
`example/src/ReaderChrome.tsx`, `example/src/readerStore.ts`, and the gesture and
animation code in `src/renderer/PageCurlView.tsx`. Two lenses, applied together:
the 10 usability heuristics for the flow, and the 12 craft rules for the surface.

The example is honest about what it is — `App.tsx` says the fixture switch exists
because "a picker would be UI to debug before the thing it is meant to be
testing", and that was the right call for proving the engine. This critique is
about what stops being right once the engine is proven, which
`docs/mupdf-integration-status.md` says it now is on a Surface Duo.

Findings are `C-n`, ordered by ID, not by priority. The ranked plan is at the
bottom.

---

## C-1 — The reading surface has no accessible representation

**H2 match between system and the real world, H1 visibility of system status.**

The Skia `Canvas` is one unlabelled node. A screen reader user gets a book-shaped
hole. `getPageText(index)` exists and returns the page's text; nothing calls it.

Fix: `handoff/reader-canvas.md` §6.1. Full detail in `a11y-audit.md` A1.

## C-2 — One unrenderable page replaces the entire reader

**H9 recognise, diagnose, recover. H3 user control and freedom.**

```jsx
onPageLoadError={(e) =>
  useReaderStore.getState().setError(`page load failed: ${String(e)}`)}
```

`error` is checked before `source` in `App.tsx`'s render, so a single page
failing to rasterise unmounts `PageCurlView` and replaces a 622-page document
with a red string. There is no way back — no retry, no dismiss, no back. The
reader has lost the book because page 214 has a damaged image stream.

The prop was added for a good reason: the comment in `PageCurlView` notes that
without it "a rejection inside the loader is an unhandled promise and the reader
just stays blank". The handler is right; its destination is wrong.

Fix: an inline panel inside the letterbox — `Page 214 didn't render` +
`Try again` — with the rest of the document still usable
(`handoff/error.md` §3). Reserve full-screen errors for failures that actually
prevent reading.

**This is the highest-severity finding in the file.** It converts a recoverable
per-page failure into total data loss from the reader's point of view.

## C-3 — The pan gesture claims every touch on the page

**H5 error prevention. Craft R11 design every state.**

`Gesture.Pan()` at `PageCurlView.tsx:395` has no `activeOffsetX`, no
`failOffsetY`, and no pointer limit. Two consequences:

- **A vertical drag starts a page turn.** Pan activates on any movement,
  reads a near-zero `translationX`, deforms the page slightly and snaps back.
  Nothing visibly breaks today because nothing scrolls over the canvas. The
  moment anything does — a TOC panel, a search list, a zoomed page — it fights
  the curl, and the arbitration will have to be retrofitted under whatever
  regression that produces.
- **`onBegin` fires on touch-down**, setting `progress.value = 0` and picking a
  direction. Resting a thumb on the page while reading enters the turn state.
  A two-finger pinch is read as a one-finger drag.

Fix: `activeOffsetX: [-12, 12]`, `failOffsetY: [-24, 24]`, `maxPointers: 1`, and
move the reset out of `onBegin` into `onStart`. Full arbitration table in
`handoff/reader-canvas.md` §4.2.

## C-4 — The way back to the controls is an invisible strip on the system gesture area

**H6 recognition rather than recall. H4 consistency and standards.**

`styles.hitArea` — `left: 0, right: 0, bottom: 0, height: 64` — is the only way
to bring dismissed chrome back. It is invisible, it is not where anyone taps to
reveal reader controls, and on Android with gesture navigation it overlaps the
system back and home gestures.

Every reader in `docs/design/mobbin/reader-canvas.md` reveals chrome by tapping
the page. This one requires discovering an unmarked 64dp band at the bottom of
the screen.

Fix: single tap anywhere on the canvas, arbitrated against the pan
(`handoff/reader-canvas.md` §4.2).

## C-5 — Chrome starts visible, and status disappears when it hides

**H1 visibility of system status. H8 aesthetic and minimalist design.**

`chromeVisible: true` in `readerStore.ts`. The reader opens a book and the first
thing over it is a control bar, which inverts the default that Nadia's and Kofi's
tasks both want.

Worse, `ReaderChrome` returns a bare `Pressable` when hidden — the page label
lives inside the visible branch. Dismissing the controls removes the only
indication of position, so a reader who wants the page uninterrupted must give up
knowing where they are.

Fix: hidden by default, with `PageLabelChip` persisting
(`handoff/reader-canvas.md` §1.1, §3).

## C-6 — There is no reduced-motion path

**Craft R12 motion is physics, not decoration.**

Nothing in `src/` or `example/` references `AccessibilityInfo` or `reduceMotion`.
A full-page conical deformation runs at every turn regardless of the system
setting. This is the category of motion that causes vestibular symptoms, and the
brief lists a reduced-motion path as mandatory.

Fix: `tokens.md` §5.3 plus the in-app override in `handoff/appearance.md` §2.
The reduced path keeps the drag, the threshold, the commit and the announcement —
only the deformation goes.

## C-7 — A button turn is 40ms slower than a drag turn

**H4 consistency and standards.**

| Path | Line | Duration |
| --- | --- | --- |
| Drag commit | `PageCurlView.tsx:437` | `withTiming(1, { duration: 280 })` |
| `turnRequest` (button) | `PageCurlView.tsx:190` | `withTiming(1, { duration: 320 })` |

Routing the button through `turnRequest` so it animates the same curl is exactly
right — the comment in `ReaderChrome` says so and the architecture follows. Then
the two paths animate at different speeds. A reader alternating between the
button and the gesture feels the button as the laggy one, and the accessibility
argument in `handoff/reader-canvas.md` §6.4 — that prev/next is an equal route to
the same action, not a lesser one — is undermined by 40ms.

Fix: set `:190` to 280ms. One number.

## C-8 — The control bar's contrast is a function of the page behind it

**Craft R7 tune your neutrals. WCAG 1.4.3.**

`rgba(20,20,20,0.82)` over an arbitrary raster. Measured at four representative
backgrounds the white label lands between **10.70:1 and 17.93:1**, so it passes
today — by accident of the bar being dark and mostly opaque. Nothing in the code
establishes the bound, and a lighter bar or a light UI theme moves it silently.

Fix: opaque `chrome.surface`. The ratio becomes a constant (16.57:1 light,
14.15:1 dark) and hiding the bar is what returns the page.

## C-9 — The document is chosen at compile time

**H7 flexibility and efficiency of use. H3 user control and freedom.**

`const FORMAT: 'cbz' | 'pdf' | 'epub' = 'epub'` in `App.tsx`. Reading a different
document means editing source and rebuilding. Nothing in the running app reaches
a second file, so none of search, TOC, bookmarks or appearance can be exercised
against a document the developer did not compile in.

Fix: `handoff/document-selector.md`.

## C-10 — RTL books page backwards and nothing says so

**H2 match between system and the real world. H9 recover from errors.**

`MuPDFSource` hardcodes `progressionDirection: 'ltr'`. `PageCurlView` mirrors the
drag correctly when told `rtl`, so the renderer is ready and the source cannot
tell it. A manga pages the wrong way and the reader has no correction available.

Fix: reading direction as a visible control defaulting to LTR
(`handoff/appearance.md` §2), until the engine reads the spine's
`page-progression-direction`. A limitation the reader can work around beats a
silent wrong answer.

## C-11 — The error state throws away information the engine produced

**H9 recognise, diagnose, recover. H2 match with the real world.**

`setError(String(e))` renders a raw exception in red. `toDocumentError` has
already parsed the failure into a seven-member union with a clean message,
specifically so the UI can branch on it — `DocumentError`'s own comment says
"Parsing it here means exactly one place knows about that convention and the UI
branches on a real union." The UI then does not branch.

The reader is shown `Error: mupdf/malformed: object is not a stream` with no
icon, no heading, no action and no way back.

Fix: five kind-specific screens (`handoff/error.md` §2), each naming the cause
and offering the action that can actually help — and offering no retry where
retrying provably cannot work.

## C-12 — Loading shows a spinner from the first frame

**H1 visibility of system status. Craft R11 design every state.**

`ActivityIndicator` plus `Loading EPUB…` renders immediately. On a fast open that
is a spinner flash, which reads as a glitch; on a slow one it never becomes more
informative, even though `pageCount` is readable well before the first raster.

Fix: `handoff/loading.md` — nothing under 400ms, page-shaped skeleton at the
document's real aspect, then determinate progress naming the stage and the count
past 800ms, then a cancel past 6s.

## C-13 — The letterbox is `#222` in every theme

**Craft R7 no pure black, no pure white; tune your neutrals. Craft R4 kill
visual monotony.**

`App.tsx` sets `container.backgroundColor: '#222'` unconditionally.
`useColorScheme()` is read and used only for `StatusBar barStyle`. Every
document, on every device, at every time of day, sits in the same dark grey
surround — including a white PDF page, which is the highest-glare pairing
available.

`#222` is also a stock value rather than a tuned neutral, and the error red
`#ff6b6b` is from a different family entirely.

Fix: `tokens.md` §3 and the page-theme control in `handoff/appearance.md`.

## C-14 — The page-label toggle has no role and a 36dp target

**Craft R11 design every state. WCAG 4.1.2, 2.5.5.**

The two arrows around it are 44 × 44dp with `accessibilityRole="button"` and
labels, and the file comments on why. The control between them — which toggles
the entire chrome — has `hitSlop={8}` around a 15pt text line, giving roughly a
36dp target, no role and no label.

Fix: same `styles.tap` treatment at 48dp, `accessibilityRole="button"`,
`accessibilityLabel`, `accessibilityState={{ expanded }}`.

## C-15 — No fold API is wired, on a library whose headline feature is the fold

**H2 match with the real world.**

`gutter={0}` is passed as a constant with a comment explaining that the seam
becomes the book's gutter. That is the right intent and it is verified visually
on hardware. But nothing reads `FoldingFeature`, so the app does not know:

- the real hinge width in dp (occlusion varies by device),
- whether the device is `FLAT` or `HALF_OPENED`,
- whether the app is spanned at all, or on one screen,
- where the fold actually is, if it is ever not at the centre.

Every dual-screen measurement in the handoff specs is built on the brief's
1080 × 720dp figure and is therefore unvalidated against a running device.

Fix: read `FoldingFeature.bounds` and `state` through
`androidx.window`, expose posture and hinge bounds to JS, and derive
`fold.hingeWidth` and `fold.safeInset` from them rather than from constants
(`tokens.md` §6).

## C-16 — Disabled turn arrows dim and nothing else

**WCAG 1.4.1. Craft R11.**

`arrowOff` is `rgba(255,255,255,0.28)`, landing between 2.29:1 and 2.52:1 against
the composited bar. Disabled controls are exempt from the contrast minima, so
this is not a 1.4.3 failure — opacity being the only cue is still a 1.4.1
concern, and at the ends of a book "disabled" and "dim" look the same as
"loading".

Fix: explicit `accessibilityState={{ disabled }}`, and at the first and last page
suppress the arrow rather than dimming it — an absent control is unambiguous.

---

## Priority actions

1. **C-2.** Stop a single page-render failure from replacing the book. It is the
   only finding here that loses the reader's whole session, the fix is an inline
   panel rather than a screen, and it is a few lines.
2. **C-1 + C-6.** Name the canvas and add the reduced-motion path. Together they
   are the difference between a reader that some people cannot use and one they
   can. `getPageText` and `AccessibilityInfo` both already exist; neither needs
   engine work.
3. **C-3.** Constrain the pan before anything is layered over the canvas. It is
   cheap now — three properties and moving one assignment from `onBegin` to
   `onStart` — and it is a regression hunt later.

---

## Ordered backlog

Grouped by what they unblock, not by size.

### Wave 1 — the reader stops losing work (C-2, C-3, C-7, C-14, C-16)

Five small, local changes inside `PageCurlView` and `ReaderChrome`. No new
screens, no new engine calls. C-7 is one number and C-3 is three properties.
After this wave the reading surface behaves correctly; it is still not
accessible and still has one document.

### Wave 2 — the reader is usable without sight or without motion (C-1, C-5, C-4, C-6)

`accessibilityLabel` from `getPageText`, `announceForAccessibility` on turn,
`accessibilityActions` on the canvas, tap-to-toggle, chrome hidden by default
with a persistent `PageLabelChip`, and the reduced-motion path. This is the wave
that changes who can use the reader at all.

### Wave 3 — failures become recoverable (C-11, C-12, C-8, C-13)

The five error screens, the staged loading state, the opaque bar and the token
palette. Each depends on `tokens.md` existing, which it now does.

### Wave 4 — the reader reaches more than one document (C-9, C-10)

The selector, and reading direction as a control. C-9 is what makes the other
five screens testable against a real book rather than a compiled-in fixture.

### Wave 5 — the fold is read rather than assumed (C-15)

`FoldingFeature` through `androidx.window`, posture and hinge bounds surfaced to
JS. Largest of the five, and the one that turns every dual-screen number in the
handoff specs from an assumption into a measurement.

---

## What the example already gets right

Worth recording, because these are the parts a rewrite should not lose:

- **The turn buttons route through `turnRequest`**, so a button press animates
  the same curl a drag does. The architecture for an accessible page turn is
  already correct; C-7 is a 40ms bug inside a right design.
- **`ReaderChrome` takes `step` and `spread` from `onLayoutChange`** rather than
  recomputing them. The comment explains why, and it is the right reason: the
  flip steps around wide pages, and a control that recomputes would move by a
  different amount than a swipe.
- **The turn arrows are 44 × 44dp deliberately**, with the WCAG reference in a
  comment. The only accessibility work in the current chrome, and it is correct.
- **`gutter={0}` with the seam as the gutter.** The central insight of the whole
  library, and it is verified on hardware.
- **`onPageLoadError` exists at all.** The handler's destination is wrong (C-2);
  noticing that a rejected loader promise would leave a silently blank reader was
  right.
- **`DocumentError` parses the native error into a typed union.** The UI does not
  use it yet (C-11), but the seam is there and it is in the right place.
