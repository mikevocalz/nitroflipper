# Design tokens

All values are Android density-independent pixels (dp) and are written the way a
`StyleSheet` would consume them. Contrast ratios were computed from the hex pairs
listed, using the WCAG 2.1 relative-luminance formula, and are quoted to two
decimal places.

Two independent theme axes, deliberately not merged:

- **Chrome theme** — bars, sheets, lists, buttons. Follows the OS via
  `useColorScheme()`. Light or dark.
- **Page theme** — the reading surface only. Chosen by the reader and persisted
  per app, not per book. Light, sepia, or dark.

Keeping them separate is what lets a reader run a sepia page inside a dark UI at
night, which is the combination Apple Books and Blinkist both allow and which the
current example cannot express at all.

---

## 1. Spacing

4dp base. Every margin, padding and gap in the handoff specs comes from this
scale. There are no one-off values.

| Token | dp | Used for |
| --- | --- | --- |
| `space.0` | 0 | Flush edges; the spread gutter when the fold supplies the gap |
| `space.1` | 4 | Icon-to-label inside a control; hairline offsets |
| `space.2` | 8 | Gap between siblings inside one group (two buttons in a pill) |
| `space.3` | 12 | Vertical rhythm inside a list row |
| `space.4` | 16 | Screen side margin on a phone; gap between groups |
| `space.5` | 20 | Sheet top padding above a grabber |
| `space.6` | 24 | Section gap; bottom inset of the reader bar |
| `space.8` | 32 | Gap between a heading and the block it introduces |
| `space.10` | 40 | Empty-state icon to headline |
| `space.12` | 48 | Screen side margin on a Duo leaf |
| `space.16` | 64 | Top padding of a full-screen state |

**Proximity rule.** Inside a group, use `space.2` or `space.3`. Between groups,
use `space.6` or larger. A list row with 12dp internal padding and 12dp between
rows has no grouping; the handoff specs never do that.

### Touch targets

| Token | dp | Rule |
| --- | --- | --- |
| `target.min` | 48 × 48 | Every interactive element. Material's minimum, above WCAG 2.5.5's 44 × 44 |
| `target.comfortable` | 56 × 56 | Reader bar controls, which are hit while walking or wearing gloves |
| `target.gap` | 8 | Minimum clear space between two adjacent targets |
| `hitSlop.default` | 8 | Applied when the visual bounds are smaller than `target.min` |

---

## 2. Type

Five sizes. Hierarchy comes from weight and colour before it comes from size.
System faces on both platforms — Roboto on Android, SF on iOS — because the
reading surface is rasterised by MuPDF and any UI face that competes with it is
noise.

| Token | Size / line-height | Weight | Letter-spacing | Used for |
| --- | --- | --- | --- | --- |
| `type.display` | 28 / 34 | 600 | −0.2 | Full-screen state headlines (error, empty) |
| `type.title` | 20 / 26 | 600 | −0.1 | Sheet titles, screen titles |
| `type.body` | 16 / 24 | 400 | 0 | List rows, result snippets, prose |
| `type.label` | 14 / 20 | 500 | 0 | Buttons, section headers, chapter names |
| `type.caption` | 12 / 16 | 400 | 0.1 | Page counts, file sizes, timestamps |

Notes that are load-bearing, not style preferences:

- Line-height ratios tighten as size grows: 1.21 at display, 1.50 at body.
- Anything that shows a page number, a page range, a result count or a file size
  sets `fontVariant: ['tabular-nums']`. A page label that shifts width between
  `9 of 622` and `10 of 622` makes the whole bar twitch on every turn.
- Result snippets and error bodies cap at 68 characters of measure. On a Duo leaf
  that is roughly 320dp at `type.body`.
- No font scaling override. `allowFontScaling` stays default-true everywhere.
  Layouts in the handoff specs are specified to survive 200% (WCAG 1.4.4), which
  is why list rows have a minimum height rather than a fixed one.

---

## 3. Colour

### 3.1 Chrome neutrals

One ramp, cool graphite (hue ≈ 222). Borders and dividers come from this ramp;
there is no stray `#ccc` anywhere in the specs. No pure black, no pure white.

| Token | Hex |
| --- | --- |
| `ink.950` | `#0F1114` |
| `ink.900` | `#16181D` |
| `ink.800` | `#22262E` |
| `ink.700` | `#333944` |
| `ink.600` | `#4A515F` |
| `ink.500` | `#6B7383` |
| `ink.400` | `#949BA8` |
| `ink.300` | `#BDC2CB` |
| `ink.200` | `#DADDE3` |
| `ink.100` | `#ECEEF1` |
| `ink.050` | `#F6F7F9` |

#### Chrome, light

| Role | Token | Hex | On | Ratio |
| --- | --- | --- | --- | --- |
| Surface | `chrome.surface` | `ink.050` `#F6F7F9` | — | — |
| Raised surface (sheet) | `chrome.raised` | `#FFFFFF` | — | — |
| Primary label | `chrome.text` | `ink.900` `#16181D` | `#F6F7F9` | **16.57:1** |
| Secondary label | `chrome.textMuted` | `ink.600` `#4A515F` | `#F6F7F9` | **7.44:1** |
| Tertiary / disabled label | `chrome.textDisabled` | `ink.500` `#6B7383` | `#F6F7F9` | **4.45:1** |
| Structural border | `chrome.border` | `#7C838F` | `#F6F7F9` | **3.56:1** |
| Decorative divider | `chrome.divider` | `ink.200` `#DADDE3` | `#F6F7F9` | 1.26:1 — decorative only |

`chrome.textDisabled` at 4.45:1 sits just under the 4.5:1 body-text floor. It is
allowed only on genuinely disabled controls, which 1.4.3 exempts. Nothing
readable uses it.

`chrome.divider` is a decorative separator between rows that are already
separated by spacing; it carries no information and is exempt from 1.4.11.
Anything that *bounds* a control — input outlines, selected-state rings, the
gutter rule — uses `chrome.border` at 3.56:1.

#### Chrome, dark

| Role | Token | Hex | On | Ratio |
| --- | --- | --- | --- | --- |
| Surface | `chrome.surface` | `ink.800` `#22262E` | — | — |
| Raised surface (sheet) | `chrome.raised` | `ink.700` `#333944` | — | — |
| Primary label | `chrome.text` | `ink.050` `#F6F7F9` | `#22262E` | **14.15:1** |
| Secondary label | `chrome.textMuted` | `ink.300` `#BDC2CB` | `#22262E` | **8.48:1** |
| Tertiary / disabled label | `chrome.textDisabled` | `ink.400` `#949BA8` | `#22262E` | **5.43:1** |
| Structural border | `chrome.border` | `ink.500` `#6B7383` | `#22262E` | 3.18:1 |
| Primary label on pressed row | — | `#F6F7F9` | `ink.700` `#333944` | **10.83:1** |

### 3.2 Page surfaces

The reading surface. Warm where the chrome is cool — that difference is the point:
chrome reads as the device, the page reads as the book, and a reader glancing down
can tell them apart without reading either.

| Theme | Token | Hex | Body text | Ratio | Secondary text | Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| Light | `page.light` | `#FBFAF7` | `#1A1A18` | **16.70:1** | `#4A4A45` | **8.54:1** |
| Sepia | `page.sepia` | `#F2E6D0` | `#3B3025` | **10.40:1** | `#6A5B49` | **5.30:1** |
| Dark | `page.dark` | `#16181A` | `#DCD8D1` | **12.53:1** | `#A8A49C` | **7.17:1** |

These colours apply to MuPDF's own raster for reflowable documents, injected as
`DocumentStyle.userCss`:

```css
/* page.sepia */
html { background: #F2E6D0 !important; color: #3B3025 !important; }
a { color: #0B5F52 !important; }
```

Fixed-layout documents (PDF, CBZ, fixed EPUB) are **not** recoloured. A scanned
page tinted sepia looks like a stain, and a PDF figure inverted for dark mode
loses its legend. Theme affects the letterbox around a fixed page and the chrome,
and the appearance screen says so on screen rather than leaving the reader to
discover it.

### 3.3 Ribbon — the position accent

One accent, one job: marking where the reader is. Current page, current TOC row,
current search hit, the active theme swatch. Nothing else in the app is this
colour, so the colour itself becomes readable as "you are here".

The source is the sewn ribbon marker in a hardback. Green rather than the
traditional red because red is reserved entirely for failure, and a position
marker and an error must never be the same hue.

| Token | Hex | On | Ratio |
| --- | --- | --- | --- |
| `ribbon.700` | `#0B5F52` | `page.light` `#FBFAF7` | **7.26:1** |
| `ribbon.700` | `#0B5F52` | `page.sepia` `#F2E6D0` | **6.13:1** |
| `ribbon.700` | `#0B5F52` | `chrome.surface` light `#F6F7F9` | **7.06:1** |
| `ribbon.600` | `#0E7A69` | fill; label `#F6F7F9` on it | **4.89:1** |
| `ribbon.300` | `#5FD3BC` | `page.dark` `#16181A` | **9.77:1** |
| `ribbon.300` | `#5FD3BC` | `chrome.surface` dark `#22262E` | **8.33:1** |
| `ribbon.300` | `#5FD3BC` | fill; label `ink.900` `#16181D` on it | **9.75:1** |

Position is never signalled by colour alone (WCAG 1.4.1). Every ribbon use pairs
with a second cue: a 3dp leading bar on a selected list row, a filled check on the
active theme swatch, `aria-current`-equivalent `accessibilityState={{selected}}`
on the control.

### 3.4 Alert — failure only

| Token | Hex | On | Ratio |
| --- | --- | --- | --- |
| `alert.600` | `#B3261E` | `chrome.surface` light `#F6F7F9` | **6.10:1** |
| `alert.600` | `#B3261E` | `page.light` `#FBFAF7` | **6.26:1** |
| `alert.600` fill | `#B3261E` | label `#FFFFFF` on it | **6.54:1** |
| `alert.200` | `#F2B8B5` | `chrome.surface` dark `#22262E` | **8.88:1** |
| `alert.200` | `#F2B8B5` | `page.dark` `#16181A` | **10.43:1** |

Every alert pairs the colour with an icon and a sentence. The error screens never
rely on red to say "this failed".

### 3.5 Search hit

| Token | Light / sepia | Dark |
| --- | --- | --- |
| `hit.fill` | `#FFE08A` | `#3A3218` |
| `hit.text` | `#1A1A18` on `#FFE08A` — **13.51:1** | `#F0E3C0` on `#3A3218` — 9.98:1 |
| `hit.rule` | `#7A5A00` — **6.12:1** on `page.light`, **5.17:1** on `page.sepia` | `#D9B24C` — **8.84:1** on `page.dark` |

`hit.rule` is a 2dp underline beneath every match. It carries the meaning when
the fill is invisible to the reader, and it survives a screenshot printed in
greyscale.

### 3.6 Scrims and overlays

| Token | Value | Used for |
| --- | --- | --- |
| `scrim.sheet` | `rgba(15,17,20,0.48)` | Behind a modal sheet, on both themes |
| `scrim.none` | `transparent` | Behind the reader bar. The bar is opaque instead |
| `overlay.bar` | `chrome.surface`, fully opaque | Reader bar. See below |

The current example draws the bar at `rgba(20,20,20,0.82)` over the page. Any
translucent surface over an unknown raster has an unknown contrast ratio — a comic
panel with a pale sky underneath drops the label below 4.5:1 and nothing in the
code notices. The bar is opaque, and it hides by default instead of being
see-through.

---

## 4. Shape, border, elevation

One elevation language: **hairline borders for structure, shadow only for things
that float over the page.** A card never gets a border *and* a heavy shadow *and*
a background shift.

| Token | Value |
| --- | --- |
| `radius.none` | 0 — the page raster, the gutter rule |
| `radius.sm` | 6 — theme swatches, text fields, chips |
| `radius.md` | 12 — sheets, cards, the reader bar |
| `radius.pill` | 999 — prev/next pill, the page-label chip |
| `border.hairline` | 1dp, `chrome.border` |
| `border.selected` | 2dp, `ribbon.700` / `ribbon.300`, plus the 3dp leading bar |
| `elevation.flat` | no shadow. Lists, bars docked to a leaf edge |
| `elevation.raised` | `0 1px 2px rgba(15,17,20,0.10)`, `0 4px 12px rgba(15,17,20,0.08)` — sheets, popovers |
| `elevation.page` | `0 1px 3px rgba(15,17,20,0.14)` — the page raster against its letterbox, so a white page on a light theme still has an edge |

No gradients anywhere. No coloured glow. If a surface reads as flat, the fix is a
better neutral or a hairline, not a fade.

---

## 5. Motion

The curl is the one piece of motion in this app that is not decoration — it is
the feedback that a turn was heard. Everything else is short, functional, and
animates `transform` and `opacity` only.

### 5.1 Page turn

These match what `src/renderer/PageCurlView.tsx` does today. Where the spec
changes a value, it says so.

| Token | Value | Source |
| --- | --- | --- |
| `motion.turn.commit` | 280ms, `withTiming` linear | `PageCurlView.tsx:437` |
| `motion.turn.button` | 320ms, `withTiming` linear | `PageCurlView.tsx:190` — the `turnRequest` path |
| `motion.turn.snapBack` | `withSpring({ damping: 20, stiffness: 180 })` | `PageCurlView.tsx:442` |
| `motion.turn.commitThreshold` | 0.5 of half-sheet travel | `COMMIT_AT` |
| `motion.turn.flickVelocity` | 400 dp/s | `FLICK_VELOCITY` |

**Change requested:** `motion.turn.button` at 320ms is 40ms slower than the same
turn made by a flick. A reader alternating between the button and the gesture
feels the button as the laggy one. Set both to 280ms. This is the only motion
value in the spec that contradicts the code, and the reason is in
`critique.md` under C-7.

### 5.2 Everything else

| Token | Duration | Easing | Properties |
| --- | --- | --- | --- |
| `motion.chrome.show` | 160ms | `ease-out` | `opacity`, `translateY` 8dp |
| `motion.chrome.hide` | 120ms | `ease-in` | `opacity`, `translateY` 8dp |
| `motion.sheet.enter` | 240ms | `ease-out` | `translateY` |
| `motion.sheet.exit` | 180ms | `ease-in` | `translateY` |
| `motion.press` | 90ms | `ease-out` | `opacity` to 0.72, `scale` to 0.97 |
| `motion.crossfade` | 150ms | `ease-out` | `opacity` — page-theme change, skeleton to content |
| `motion.spinner` | 900ms loop | linear | Indeterminate progress only, and only after the delay in §5.4 |

Nothing bounces. Nothing loops except the one indeterminate spinner. No
auto-playing decoration.

### 5.3 Reduced motion

`AccessibilityInfo.isReduceMotionEnabled()` plus the
`reduceMotionChanged` subscription. The example wires neither today; the
appearance screen also exposes an in-app override, because a reader can want a
still page turn without turning motion off system-wide.

The reduced path is a working reader, not a degraded one. Every turn still
happens, still updates the page label, still fires the same announcement.

| Token | Standard | Reduced |
| --- | --- | --- |
| `motion.turn.commit` | 280ms curl | 0ms — the destination page is drawn on the next frame, no curl geometry evaluated |
| `motion.turn.snapBack` | spring | 0ms — `progress` set to 0 directly |
| `motion.turn.drag` | curl follows the finger | curl is not driven; the drag is read for direction and threshold only, and commits on release |
| `motion.chrome.show/hide` | 160/120ms slide + fade | 100ms fade, no translate |
| `motion.sheet.enter/exit` | 240/180ms slide | 120ms fade, no translate |
| `motion.press` | opacity + scale | opacity only |
| `motion.crossfade` | 150ms | 0ms — swap |
| `motion.spinner` | rotating indicator | static indicator plus a determinate percentage where one exists; no rotation |

The drag row is the important one. Killing the curl must not kill the gesture —
a reader on reduced motion still drags to turn, they just do not see the page
deform while they do it.

### 5.4 Progress thresholds

| Token | Value | Rule |
| --- | --- | --- |
| `delay.spinnerOnset` | 400ms | Below this, show nothing. A flash of spinner reads as a glitch |
| `delay.skeletonToProgress` | 800ms | Past this, the loading screen switches from a page-shaped skeleton to a labelled progress row with a page count |
| `delay.slowWarning` | 6000ms | Past this, add the "Still opening — large documents can take a moment" line and a Cancel control |
| `delay.announceDebounce` | 500ms | Screen-reader page announcements coalesce; a four-page flick announces the destination once |

---

## 6. Dual-screen geometry

Figures for the Surface Duo spanned, as given in the brief: **1080 × 720 dp**,
fold at the horizontal centre.

| Token | Value | Note |
| --- | --- | --- |
| `fold.axis` | vertical, at `x = 540dp` | Book orientation. A horizontal fold is out of scope |
| `fold.leafWidth` | 540dp | Before hinge occlusion |
| `fold.hingeWidth` | **must be read at runtime** | Jetpack WindowManager `FoldingFeature.bounds`. Do not hardcode. The example wires no fold API at all today |
| `fold.safeInset` | 24dp | Minimum clearance from the fold for any text or target, measured from the hinge bounds, not from the centre line |
| `gutter.spread` | `space.0` | On a folding device the hinge *is* the gutter. `PageCurlView` already takes `gutter={0}` for this |
| `gutter.flat` | 16dp | On a tablet or a phone in landscape, a real 16dp gap plus a 1dp `chrome.border` rule down the centre |

**The rule that shapes every overlay spec: chrome never crosses the fold.** A
sheet, a bar, a dialog or a list that straddles the hinge is cut in half by
physical glass. On a spanned device every overlay docks to one leaf — the right
leaf for LTR, the left for RTL — and the other leaf keeps showing the page.

Occlusion is a `FoldingFeature` property, not a constant. `HALF_OPENED` posture
adds a third case (the leaves are at an angle) which this design treats the same
as `FLAT` for layout and flags as unverified.

---

## 7. Component inventory

Every component the nine screens need. Anything not on this list is not designed
and should not be built.

### Reader surface

| Component | Notes |
| --- | --- |
| `PageCanvas` | Exists — `PageCurlView`. Owns the curl, the pan gesture, the texture cache |
| `PageLetterbox` | The band around a fixed-layout page when its aspect does not fill the leaf. Takes `page.*` colour, carries `elevation.page` |
| `GutterRule` | 1dp `chrome.border` down the centre in flat spread mode. Absent on a folding device, where the hinge does the job |
| `ReaderBar` | Opaque, docked to the bottom of one leaf. Hosts prev, page label, next, and the four screen entries |
| `PageLabelChip` | `type.caption`, tabular-nums. The only element visible when chrome is hidden. Reads `9–10 of 622` in spread, `9 of 622` in single |
| `TurnButton` | 56 × 56dp, routes through `turnRequest` so it animates the same curl a drag does |
| `ChromeRevealTarget` | Full-leaf single-tap target that toggles the bar. Must not swallow the pan |

### Navigation and lists

| Component | Notes |
| --- | --- |
| `DocumentRow` | Selector row: format badge, filename, size, last-read position, progress bar |
| `FormatBadge` | `PDF` / `EPUB` / `CBZ`, `type.caption`, 1dp border. Text, not a coloured dot |
| `OutlineRow` | TOC row: title indented by `depth × 16dp`, page number right-aligned, tabular-nums |
| `SearchResultRow` | Chapter label, snippet with `hit.fill` + `hit.rule`, page number |
| `BookmarkRow` | Page number, captured snippet or page thumbnail, saved date, delete affordance |
| `SelectedMarker` | 3dp `ribbon` leading bar. The non-colour half of the current-item cue |
| `EmptyState` | Icon, `type.title` headline, `type.body` explanation, one action |

### Input and controls

| Component | Notes |
| --- | --- |
| `SearchField` | Persistent label above the field, clear button, result counter, prev/next match |
| `PasswordField` | Persistent label, reveal toggle, `textContentType="password"` |
| `StepperRow` | Font size: minus, value, plus. Not a slider — see `handoff/appearance.md` |
| `ThemeSwatch` | Three: light, sepia, dark. Each renders real text on its own background, 56 × 72dp |
| `SegmentedControl` | Reading direction (LTR / RTL), spread mode (Auto / Single / Spread) |
| `SwitchRow` | Reduced page-turn animation; publisher styles |
| `PrimaryButton` | 48dp tall, `ribbon.600` fill light / `ribbon.300` fill dark |
| `TextButton` | 48dp tall, label only |

### Containers and feedback

| Component | Notes |
| --- | --- |
| `LeafSheet` | The dual-screen overlay container. Bottom sheet on a phone, full-height side panel docked to one leaf when spanned |
| `PageSkeleton` | Page-shaped rectangles at the real page aspect, no shimmer |
| `ProgressRow` | Determinate bar plus `type.caption` count, for opens past `delay.skeletonToProgress` |
| `ErrorPanel` | Icon, headline, cause, one primary action, one escape |
| `Toast` | Bottom of the active leaf, 4s, dismissible. Used for "Saved to bookmarks" and the undo after a TOC jump |

### Explicitly not in the inventory

| Not built | Reason |
| --- | --- |
| Selection handles, highlight menu, copy/share-quote | Text selection is not implemented. Drawing the affordance would promise it |
| Note editor, annotation layer | Same |
| Pinch-zoom and pan on a page | Not implemented in `PageCurlView`. See the gesture section of `handoff/reader-canvas.md` for how the space is reserved without shipping a dead gesture |
| Page thumbnail scrubber | Needs N cheap thumbnail renders. `renderPage` currently rasterises twice per call; a scrubber would multiply that. Marked **Aspirational** in `handoff/reader-canvas.md` |
| Library sync, cloud, accounts | Out of scope for an example app |
| OCR affordance on a scanned PDF | No OCR. The search screen explains the absence instead |
