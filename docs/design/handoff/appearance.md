# Handoff — appearance and text size

Backed by `MuPDFSource.relayout(layout: DocumentLayout)` and
`setStyle(style: DocumentStyle)`.

Three things make this screen different from every reference in
`docs/design/mobbin/appearance.md`:

1. **Every change is a full relayout.** It bumps `layoutGeneration`, invalidates
   the texture cache and re-paginates the book.
2. **The reader's place is preserved by `fz_make_bookmark`**, taken before the
   relayout and resolved after. This is tested (`a locator survives a relayout at
   a different font size`) and it is the reason a font-size change is safe.
3. **Fixed-layout documents ignore most of this.** `relayout` resolves without
   bumping the generation for a PDF or CBZ. The screen says so on screen rather
   than letting the reader discover it by pressing a dead button.

---

## 1. Layout

### 1.1 Phone — bottom sheet, 56% height

Deliberately shorter than the TOC and bookmark sheets. The reader is judging a
change against their own page, so the page has to stay visible.

```
┌──────────────────────────────┐
│                              │
│  page raster — stays live,   │  44% of the screen, re-renders on change
│  no scrim over it            │
│  ────────────────────        │
├──────────────────────────────┤
│            ────              │
│ Appearance                ✕  │
│                              │
│ Text size                    │  type.label, chrome.textMuted
│   ╭────╮   12 pt    ╭────╮   │  StepperRow, 48dp targets
│   │ –  │            │  + │   │
│   ╰────╯            ╰────╯   │
│                              │
│ Page theme                   │
│  ┌────┐  ┌────┐  ┌────┐      │  ThemeSwatch, 56 × 72dp
│  │ Aa │  │ Aa │  │ Aa │      │  real text on real background
│  └────┘  └────┘  └────┘      │
│   Light   Sepia   Dark  ✓    │
│                              │
│ Reading direction            │
│  ╭───────────┬───────────╮   │  SegmentedControl
│  │Left→right │Right→left │   │
│  ╰───────────┴───────────╯   │
│                              │
│ Pages                        │
│  ╭──────┬────────┬───────╮   │
│  │ Auto │ Single │Spread │   │
│  ╰──────┴────────┴───────╯   │
│                              │
│ Reduce page-turn animation ◯ │  SwitchRow
│ Use publisher styles       ● │  SwitchRow, reflowable only
│                              │
│ Reset to defaults            │  TextButton, always last
└──────────────────────────────┘
```

**No scrim.** Scrimming the page would defeat the live preview.

### 1.2 Surface Duo, spanned — side panel on one leaf

Panel on the right leaf (left for RTL), page live and full-height on the other.
The best version of this screen: the reader watches a full page repaginate while
they press `+`. Spread does **not** collapse here — the reader may be adjusting
size precisely to judge how two pages pair, so the left leaf keeps whatever mode
they were reading in.

---

## 2. Controls and their engine calls

| Control | Values | Call |
| --- | --- | --- |
| Text size | 9, 10, 11, 12, 14, 16, 18, 21, 24 pt. Default 12 | `relayout({ width: leafW, height: leafH, fontSizePt })` |
| Page theme | Light, Sepia, Dark | `setStyle({ usePublisherStyles, userCss })` then `relayout(...)`; also sets `page.*` for the letterbox and `PageCurlView`'s `appearance` cache-key prop |
| Reading direction | LTR, RTL | Overrides `source.progressionDirection` |
| Pages | Auto, Single, Spread | `PageCurlView`'s existing `spread?: boolean`; `Auto` passes `undefined` |
| Reduce page-turn animation | On, Off, System | Local. Defaults to `System`, which reads `AccessibilityInfo.isReduceMotionEnabled()` |
| Use publisher styles | On, Off | `setStyle({ usePublisherStyles })` |

**Nine discrete sizes, not a slider.** Each step is one relayout of the whole
book. A slider dragged across its range fires dozens, each invalidating the
texture cache, on a single worker thread that also has to render the page the
reader is looking at.

`width` is **one leaf, not the spread**. Passing the spread width makes every
line run across both pages — the trap already commented at `example/App.tsx:83`
and in `DocumentLayout`'s own doc comment.

**Reading direction is a control because the engine cannot detect it.**
`MuPDFSource` hardcodes `progressionDirection` to `ltr`; the spine's
`page-progression-direction` is not read. A manga or an Arabic EPUB pages the
wrong way with no way to say so. When the engine reads the spine, this control
gains a third `Auto` segment and defaults to it.

---

## 3. Tokens

| Element | Token |
| --- | --- |
| Panel surface | `chrome.raised`, `elevation.raised`, `radius.md` top |
| Section header | `type.label`, `chrome.textMuted`, `space.6` above, `space.3` below |
| `StepperRow` buttons | 48 × 48dp, 1dp `chrome.border`, `radius.sm` |
| Stepper value | `type.title` tabular-nums, `chrome.text`, fixed 72dp width |
| `ThemeSwatch` | 56 × 72dp, `radius.sm`, 1dp `chrome.border`. Fill is that theme's `page.*`; the `Aa` is that theme's body colour |
| Selected swatch | 2dp `ribbon` ring + a filled check at the bottom-right + the label in `chrome.text` |
| `SegmentedControl` | 40dp tall, 1dp `chrome.border`, `radius.sm`; selected segment `ribbon.600` fill / `#F6F7F9` label — 4.89:1 |
| `SwitchRow` | 56dp, label `type.body`, platform switch, whole row is the target |
| Reset | `TextButton`, 48dp, `chrome.text` |
| Theme change | `motion.crossfade` 150ms on the page raster |
| Panel enter / exit | `motion.sheet.enter` / `motion.sheet.exit` |

The swatches are the one place in the app where three page backgrounds sit side
by side. Each renders its own real pair — `#1A1A18` on `#FBFAF7` (16.70:1),
`#3B3025` on `#F2E6D0` (10.40:1), `#DCD8D1` on `#16181A` (12.53:1) — so the
reader compares actual contrast, not a colour chip.

---

## 4. States

| State | Behaviour and copy |
| --- | --- |
| `reflowable` | All controls live |
| `fixedLayout` | Text size and publisher styles disabled, with a visible explanation in the section: `This document has fixed pages. Text size and publisher styles apply to EPUB books that reflow.` Theme applies only to the letterbox and the chrome; a second line says so: `Page theme changes the background around the page. The page itself is an image and isn't recoloured.` |
| `relayouting` | Stepper disabled, 2dp indeterminate bar under the section, value shows the pending size at 60% opacity. Past `delay.slowWarning` (6s) a line appears: `Re-paginating 622 pages` |
| `relayoutFailed` | Value reverts, inline `alert` row: `Couldn't change text size` + `DocumentError.message` in `type.caption` |
| `atMinSize` / `atMaxSize` | `–` or `+` disabled with `accessibilityState.disabled`; no error, no toast |
| `themeChanging` | `PageCurlView`'s `appearance` prop changes, invalidating the cache; the letterbox crossfades over 150ms while the raster re-renders |
| `reset` | One tap, no confirmation. Returns 12 pt / Light / LTR / Auto / System / publisher styles on. Toast with `Undo` for 6s |

---

## 5. Gesture conflicts

- **The page-turn pan stays live on both layouts.** Unlike the TOC and search
  panels, nothing here goes stale when the page turns — the reader may want to
  check a different page at the new size. This is the only panel that does not
  lock the canvas.
- **Sheet drag-down only at `scrollY === 0`** on the phone.
- **Stepper repeat on hold is not implemented.** Each press is one relayout;
  auto-repeat would queue nine of them. Press, wait, see the result.

---

## 6. Single vs spread

The `Pages` control is where single vs spread is chosen, and it is the only
screen that sets it.

`Auto` is the default and delegates to `shouldUseSpread`. `Single` and `Spread`
override it, and `Spread` on a viewport too narrow to fit two pages is honoured
literally — the pages scale down. The control's helper line says so:
`Spread shows two pages at once. On a narrow screen they'll be small.` A control
that silently ignores the reader is worse than one that does what it is told.

Changing this while reading keeps the reader's page as the **leading** page, via
`PositionResolver`. The single→spread→single round-trip is tested at three font
sizes.

---

## 7. Accessibility

- **Persistent visible labels on every control** (3.3.2). No control here is
  identified by position alone.
- **Stepper**: the `–` and `+` buttons are named `Smaller text` and `Larger
  text`, not `Minus` and `Plus`. The value is a separate node named
  `Text size, 12 point`, `accessibilityRole="adjustable"` with `increment` and
  `decrement` actions so a screen reader user can change it by swipe without
  hunting for two 48dp buttons.
- **Swatches**: `accessibilityRole="radio"`, `accessibilityState={{ checked }}`,
  names `Light page`, `Sepia page`, `Dark page`. Grouped with
  `accessibilityRole="radiogroup"` and the label `Page theme`.
- **Disabled controls explain themselves** (3.3.2). The fixed-layout explanation
  is visible text in the section, not a tooltip, and it is in the disabled
  control's accessible name too: `Text size, 12 point. Not available — this
  document has fixed pages.`
- **Announce a completed relayout**: `announceForAccessibility('Text size 14
  point. Now 704 pages.')` The page count changing is the most concrete
  confirmation the change took effect.
- **Reduced motion is a control on this screen**, three-valued, defaulting to
  `System`. A reader can want still page turns without disabling motion
  system-wide, and the reverse — the explicit setting wins over the system one
  when it is not `System`.
- **Touch targets**: all 48dp or larger. Swatches are 56 × 72dp with `space.2`
  between them, clearing `target.gap`.
- **Focus** enters the panel title, traverses in visual order, ends on `Reset`,
  and returns to the Appearance button on close.
- **Text scaling**: at 200% the segmented controls stack to two rows of
  full-width buttons rather than truncating their labels. `Left → right` must
  never render as `Left → r…`.
