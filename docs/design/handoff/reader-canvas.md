# Handoff — reader canvas with controls

The primary screen. Everything else is reached from it and returns to it.

Implementation surface today: `example/App.tsx` renders `PageCurlView` plus
`example/src/ReaderChrome.tsx`. This spec replaces `ReaderChrome` and adds no
props to `PageCurlView` beyond those it already accepts.

---

## 1. Layout

### 1.1 Phone, portrait — 412 × 915dp reference

```
┌──────────────────────────────┐ ← status bar, page paints under it
│                              │
│   ┌──────────────────────┐   │  letterbox: page.* colour
│   │                      │   │  page raster, elevation.page
│   │      page raster     │   │  centred, aspect from getPageBox()
│   │                      │   │
│   └──────────────────────┘   │
│                    ┌───────┐ │  PageLabelChip
│                    │ 9/622 │ │  bottom-right of the letterbox
│                    └───────┘ │  space.4 from each edge
│ ╭──────────────────────────╮ │  ReaderBar, hidden by default
│ │ ‹  9 of 622  ›  ☰ ⌕ ⚑ Aa │ │  56dp tall + bottom safe inset
│ ╰──────────────────────────╯ │  space.4 side margins, radius.md
└──────────────────────────────┘
```

- Letterbox fills the whole screen. Page raster centred inside it.
- `ReaderBar` floats `space.6` (24dp) above the bottom safe inset, inset
  `space.4` (16dp) each side, `radius.md`, `elevation.raised`, **opaque**
  `chrome.surface`.
- `PageLabelChip` sits at the letterbox's bottom-right, `space.4` from both
  edges, and moves to `space.6` above the bar when the bar is visible.

### 1.2 Surface Duo, spanned — 1080 × 720dp, fold at x = 540dp

```
        left leaf 540dp        │ hinge │        right leaf 540dp
┌───────────────────────────────┬─────┬───────────────────────────────┐
│                               │▓▓▓▓▓│                               │
│      page raster, leaf 1      │▓▓▓▓▓│      page raster, leaf 2      │
│         (verso, left)         │▓▓▓▓▓│         (recto, right)        │
│                               │▓▓▓▓▓│                               │
│                               │▓▓▓▓▓│                  ┌──────────┐ │
│                               │▓▓▓▓▓│                  │ 9–10/622 │ │
│                               │▓▓▓▓▓│  ╭────────────────────────╮  │
│                               │▓▓▓▓▓│  │ ‹ 9–10 of 622 › ☰ ⌕ ⚑ Aa│  │
└───────────────────────────────┴─────┴───────────────────────────────┘
                                   ▲
                       fold.hingeWidth — read from
                       FoldingFeature.bounds, never hardcoded
```

- `gutter={0}`. The hinge is the gutter, which is why the pages meet at the
  spine and the seam becomes the book's. `App.tsx` already passes this.
- **`ReaderBar` docks entirely inside the right leaf for LTR**, inset `space.12`
  (48dp) from the leaf's outer edge and `fold.safeInset` (24dp) from the hinge
  bounds. For RTL it docks inside the left leaf. It never crosses the fold.
- `PageLabelChip` sits in the same leaf as the bar.
- No `GutterRule`. The physical hinge supplies the separation.

### 1.3 Tablet or phone landscape, spread, no fold — flat spread

Identical to 1.2 with two changes: `gutter = 16dp`, and a `GutterRule` — 1dp
`chrome.border`, full letterbox height — down the centre. Without a physical
seam, two pages butted together read as one wide page.

### 1.4 Deriving spread

`PageCurlView` already decides this via `shouldUseSpread(viewport, pageBox,
'auto')`: a spread is used when `2 × (pageW / pageH) × viewportH ≤ viewportW`.
It reports the outcome through `onLayoutChange({ step, spread })`, and
`ReaderChrome` already consumes it. **Never recompute the step in the bar** —
the flip is stepped around wide pages, and a bar that recomputes will move by a
different amount than a swipe does.

The appearance screen offers `Auto / Single / Spread` as an override, passed
through as `PageCurlView`'s existing `spread?: boolean`.

---

## 2. Tokens

| Element | Token |
| --- | --- |
| Letterbox | `page.light` `#FBFAF7` / `page.sepia` `#F2E6D0` / `page.dark` `#16181A` |
| Page raster edge | `elevation.page` `0 1px 3px rgba(15,17,20,0.14)` |
| `GutterRule` | 1dp `chrome.border` — `#7C838F` light, `#6B7383` dark |
| `ReaderBar` surface | `chrome.surface`, opaque; `radius.md`; `elevation.raised` |
| Bar label | `type.body` 16/24, tabular-nums, `chrome.text` — 16.57:1 light, 14.15:1 dark |
| Bar icons | `chrome.text`, 24dp glyph in a `target.comfortable` 56 × 56dp box |
| Disabled turn arrow | `chrome.textDisabled` + `accessibilityState={{ disabled: true }}` |
| `PageLabelChip` | `type.caption` 12/16 tabular-nums; `page.*` body colour at 88% on a 1dp `chrome.border` outline, `radius.pill`, 8dp × 4dp padding |
| Bar show / hide | `motion.chrome.show` 160ms ease-out / `motion.chrome.hide` 120ms ease-in |
| Turn (drag) | `motion.turn.commit` 280ms |
| Turn (button) | `motion.turn.button` — **set to 280ms**, currently 320ms at `PageCurlView.tsx:190` |
| Snap back | `motion.turn.snapBack` spring, damping 20, stiffness 180 |

The chip's 88% opacity is over a known background — the letterbox, which is a
token colour, not the page raster. It never sits over artwork.

---

## 3. States

| State | Trigger | Appearance |
| --- | --- | --- |
| `reading` | Default | Page. `PageLabelChip` only. No bar |
| `chromeVisible` | Single tap, or focus arriving from a screen reader / keyboard | Bar slides up + fades in over 160ms. Auto-hides after 6s of no interaction, unless a screen reader or an external keyboard is attached |
| `turning` | Drag past `COMMIT_AT`, flick past `FLICK_VELOCITY`, or `turnRequest` | Curl animates. Bar arrows disabled for the duration — `turning.value` already guards the gesture; the same guard drives the buttons |
| `atStart` | `pageIndex - step < 0` | Previous disabled. A backward drag does not deform the page at all (`canGoBack` already returns early), so the reader gets no false affordance |
| `atEnd` | `pageIndex + step ≥ pageCount` | Next disabled. Same rule forward |
| `pageLoading` | Destination raster not in cache when the curl ends | Current page holds. Chip switches to a 16dp indeterminate indicator after `delay.spinnerOnset` (400ms). Never a full-screen skeleton |
| `pageFailed` | `onPageLoadError` fires | Inline panel inside the letterbox, not a screen change: `Page 214 didn't render` + `Try again`. The rest of the document stays usable. Today this routes to a full-screen error and takes the whole reader down |
| `singleWidePage` | `PageCurlView` shows a double-width page alone in spread mode | The chip reads `10 of 622 · wide page`. Without it, Kofi reads a correct spread as a pairing bug |

---

## 4. Gesture arbitration

The hard part of this screen, and where the current implementation has a real
defect.

### 4.1 What exists today

`Gesture.Pan()` with no activation constraints (`PageCurlView.tsx:395`).
`onBegin` sets `progress.value = 0` and picks a direction from the touch's x
position. There is no tap gesture on the canvas — chrome is toggled by a 64dp
strip pinned to the bottom of the screen (`ReaderChrome.styles.hitArea`).

Consequences:

- **A vertical drag starts a page turn.** Pan claims the touch on any movement
  in any direction, then reads `translationX`, which is near zero. The page
  deforms by a few pixels and snaps back. No content scrolls today, so nothing
  visibly breaks, but the moment anything scrollable appears over the canvas it
  will fight the curl.
- **A stationary touch enters the turn state.** `onBegin` runs on touch-down and
  resets `progress`, so resting a thumb on the page while reading puts the view
  in a mid-gesture state with no visible change.
- **Tapping the page does nothing.** Only the bottom 64dp toggles chrome, which
  is undiscoverable and collides with the Android back-gesture edge.

### 4.2 Specified arbitration

Three gestures on the canvas, with explicit precedence.

| Gesture | Config | Claims the touch when |
| --- | --- | --- |
| `Gesture.Tap()` | `maxDuration: 250`, `maxDistance: 8dp`, `numberOfTaps: 1` | Released inside 250ms having moved under 8dp |
| `Gesture.Pan()` | `activeOffsetX: [-12, 12]`, `failOffsetY: [-24, 24]`, `minPointers: 1`, `maxPointers: 1` | Horizontal travel passes 12dp before vertical travel passes 24dp |
| `Gesture.Pinch()` | **Not attached.** Reserved, not shipped | — |

Composed with `Gesture.Exclusive(pan, tap)` — pan wins once it activates, tap
fires only if pan never did.

**`activeOffsetX: [-12, 12]`** — under 12dp of horizontal travel the reader is
holding the device, not turning a page. Twelve is roughly half a fingertip and
sits below the threshold at which a deliberate drag is visible.

**`failOffsetY: [-24, 24]`** — 24dp of vertical travel before 12dp of horizontal
means the reader is not turning a page. Pan fails and releases the touch. This
is the line that has to exist before anything scrollable is layered over the
canvas.

**`onBegin` must stop resetting `progress`.** Move `progress.value = 0` and the
direction pick from `onBegin` to `onStart`, which fires on activation rather
than on touch-down. A resting thumb then never enters the turn state.

### 4.3 Zoom and pan — reserved, not shipped

Pinch-zoom on a page is not implemented in `PageCurlView` and is not designed
here. The space is reserved rather than filled:

- `maxPointers: 1` on the pan, so a two-finger gesture is never read as a turn.
  A reader who pinches today gets nothing, which is honest. Without this they
  get a page turn, which is wrong.
- When zoom ships, it takes the two-finger slot and a zoomed page raises a
  `zoomed` flag; while that flag is set, a one-finger drag pans the raster and
  the page turn moves to the bar buttons and to a drag that starts within 24dp
  of the leaf's outer edge. That rule is written down here so the eventual
  implementation does not have to reinvent the arbitration.

### 4.4 Selection — deliberately unclaimed

Text selection is not implemented anywhere in the library. **No long-press
gesture is attached to the canvas, and none should be.** A long-press that
produces a flash of feedback and no menu is worse than a long-press that does
nothing, because the first teaches the reader a capability exists.

When selection ships it takes long-press (500ms, `maxDistance: 8dp`), fails the
pan for that touch, and requires `getPageText` plus per-character quads that the
engine does not currently expose. **Aspirational.**

### 4.5 Direction and RTL

`PageCurlView` already reads `source.progressionDirection` and mirrors the drag
(`rtl ? event.translationX : -event.translationX`). The problem is upstream:
`MuPDFSource` hardcodes `progressionDirection` to `ltr` because the engine does
not read the spine's `page-progression-direction`. An RTL-bound book pages the
wrong way and nothing in the app says so.

Until the engine reads the spine, **reading direction is a user-facing control**
in the appearance screen, defaulting to LTR. It overrides the source's value. A
setting the reader can fix beats a silent wrong answer.

---

## 5. Single vs spread

| | Single | Spread |
| --- | --- | --- |
| Step | 1 | 2, except across a wide page, where `PageCurlView` steps 1 |
| Chip copy | `9 of 622` | `9–10 of 622` |
| Bar label | `9 of 622` | `9–10 of 622` |
| Curl origin | Outer edge of the single leaf | Outer edge of the leading leaf; the trailing leaf is static |
| Bar position | Centred | Docked to one leaf (spanned) or centred (flat spread) |
| Wide page | n/a | Shown alone across the full viewport; chip appends ` · wide page` |

A rotation or a fold-posture change re-runs `shouldUseSpread`, which changes both
`step` and the raster size. The cache key already includes the viewport
(ADR-0003), so the pages re-render at the right size. The **page label must not
jump**: on a single→spread transition the leading page stays the leading page.
`PositionResolver` handles this and the round-trip is tested at three font sizes.

---

## 6. Accessibility

### 6.1 The canvas itself

`PageCurlView` renders a Skia `Canvas`. To a screen reader it is one opaque node.
It needs:

```
accessible
accessibilityRole="image"
accessibilityLabel   → see below
accessibilityActions → [{name:'nextPage'}, {name:'previousPage'}]
onAccessibilityAction → routes to requestTurn(+1 / -1)
```

**The label is the reading representation, and it is the weakest part of this
spec.** Options, in descending honesty:

1. **Reflowable documents:** `getPageText(index)` returns the page's text.
   Use it as the label. A screen reader then reads the actual page. This is the
   only genuinely accessible path and it works today for EPUB.
2. **Fixed-layout PDFs with a text layer:** same call, same result. Layout
   fidelity is lost — MuPDF returns a reading order, not a visual one — but the
   words are there.
3. **Image-only PDFs and CBZ:** `getPageText` returns empty. The label falls back
   to `Page 214 of 622. This page is an image with no text.` **A CBZ comic is
   not readable by a screen reader through this library and this spec does not
   pretend otherwise.**

Because `getPageText` is async and the label is a prop, the label starts as
`Page 214 of 622` and is replaced when the text resolves.

### 6.2 Announcements

Every committed turn fires `AccessibilityInfo.announceForAccessibility`, debounced
by `delay.announceDebounce` (500ms) so a four-page flick announces once:
`Page 215 of 622` (single) or `Pages 215 to 216 of 622` (spread).

### 6.3 Chrome visibility and assistive tech

Auto-hide is suspended when `AccessibilityInfo.isScreenReaderEnabled()` is true
or an external keyboard is attached. A bar that disappears after 6 seconds is a
target that vanishes mid-exploration.

### 6.4 Prev/next as a first-class alternative (WCAG 2.5.1, 2.1.1)

The curl is a path-based gesture. A reader with a tremor, using a switch, on a
head pointer, or wearing gloves needs a non-path route to the same action, and
that route must not be a lesser one.

- `TurnButton` is 56 × 56dp with 8dp clear space, and routes through
  `turnRequest` so the animation and the resulting index are identical to a drag.
- `accessibilityActions` on the canvas give a screen reader user the same two
  actions without needing to find the bar.
- Volume-key paging is **not** specified. It conflicts with media apps and cannot
  be discovered.
- External keyboard: `←` / `→` (`↑` / `↓` in RTL), `Space` forward,
  `Shift+Space` back, `Home` / `End` to first and last page.

Nothing on this screen uses colour as its only cue (WCAG 1.4.1). Disabled arrows
carry `accessibilityState.disabled` as well as `chrome.textDisabled`.

### 6.5 Reduced motion

`motion.turn.commit` and `motion.turn.button` both go to 0ms; the destination
page is drawn on the next frame. The drag still works — direction and threshold
are still read — the page simply does not deform while the finger moves. Both
the system setting and the in-app override in `handoff/appearance.md` are honoured,
with the in-app override winning when it is explicitly set.

### 6.6 Focus order

`PageCanvas` → `PageLabelChip` → previous → page label → next → Contents →
Search → Bookmarks → Appearance. Visual order matches. Opening any panel moves
focus into it and returns focus to the control that opened it on dismiss.

### 6.7 Text scaling (WCAG 1.4.4)

At 200% font scale the bar label `9–10 of 622` at `type.body` runs to roughly
230dp. On a 540dp Duo leaf inset 48dp and 24dp, the bar has 468dp — the label
plus two 56dp arrows fits. On a 412dp phone with `space.4` margins the bar has
380dp, and it does not. **At scales above 130%, the bar wraps to two rows**:
arrows and label on the first, the four destination icons on the second, bar
height 112dp. Specified rather than left to flex.
