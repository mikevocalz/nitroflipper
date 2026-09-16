# Handoff — table of contents

Backed by `MuPDFSource.getOutline(): Promise<OutlineEntry[]>`, flattened with an
explicit `depth`. Each entry carries `title`, `depth`, `uri`, `pageNumber`
(**-1 when unresolvable in this layout**), `chapter`, `page`.

---

## 1. Layout

### 1.1 Phone — bottom sheet, 88% height

```
┌──────────────────────────────┐
│ ▓▓▓▓ page still visible ▓▓▓▓ │  12% of the screen, scrim.sheet over it
├──────────────────────────────┤
│            ────              │  grabber, 32 × 4dp, chrome.border
│ Contents                  ✕  │  type.title / 48dp close target
│ Drive coupling service manual│  type.caption, chrome.textMuted, 1 line
├──────────────────────────────┤
│▌1  Safety                 12 │  ▌ = 3dp ribbon bar, current section
│   1.1 Lockout procedure   14 │  depth 1 → 16dp inset
│   1.2 Lifting points      19 │
│ 2  Drive coupling         31 │  depth 0
│      Torque specifications   │  pageNumber === -1, no number shown
│ 3  Hydraulics             77 │
└──────────────────────────────┘
```

Sheet, `radius.md` top corners, `chrome.raised`, `elevation.raised`. Scrim
`rgba(15,17,20,0.48)`. Dismiss: drag down, tap scrim, `✕`, system back.

### 1.2 Surface Duo, spanned — side panel on one leaf

```
        left leaf 540dp        │hinge│      right leaf 540dp
┌───────────────────────────────┬────┬──────────────────────────────┐
│                               │▓▓▓▓│ Contents                  ✕  │
│    page raster keeps          │▓▓▓▓│ ─────────────────────────────│
│    the left leaf, live        │▓▓▓▓│▌1  Safety                 12 │
│                               │▓▓▓▓│   1.1 Lockout procedure   14 │
│                               │▓▓▓▓│ 2  Drive coupling         31 │
│                               │▓▓▓▓│ 3  Hydraulics             77 │
└───────────────────────────────┴────┴──────────────────────────────┘
```

The panel takes the right leaf entirely (left leaf for RTL). **No scrim** — the
left leaf stays a live, readable page, which is the whole advantage of the
hardware. The reader compares the outline against the page they are on.

Spread collapses to single while the panel is open: `PageCurlView` gets
`spread={false}` and `width={540 - fold.hingeWidth/2}`. The page re-renders at
the new raster size; the cache key includes the viewport (ADR-0003), so this is
correct rather than a stale-size redraw.

---

## 2. Tokens

| Element | Token |
| --- | --- |
| Sheet / panel surface | `chrome.raised` — `#FFFFFF` light, `ink.700` `#333944` dark |
| Scrim (phone only) | `scrim.sheet` `rgba(15,17,20,0.48)` |
| Panel title | `type.title` 20/26, `chrome.text` |
| Document subtitle | `type.caption`, `chrome.textMuted` |
| Row | 48dp min height, `space.3` vertical, `space.4` horizontal |
| Row title | `type.body`, `chrome.text` |
| Depth inset | `depth × 16dp` added to the leading padding, capped at 4 levels (64dp) |
| Page number | `type.caption`, tabular-nums, `chrome.textMuted`, right-aligned, 48dp column |
| Current row | 3dp `ribbon` leading bar + `ribbon` at 8% fill + `selected` state |
| Row pressed | `chrome.surface` fill, `motion.press` |
| Panel enter / exit | `motion.sheet.enter` 240ms ease-out / `motion.sheet.exit` 180ms ease-in |

Depth cap: past four levels, indentation eats the title. Levels 5+ render at
64dp and rely on the accessible name to carry the real depth.

---

## 3. States

| State | Behaviour |
| --- | --- |
| `loading` | `getOutline()` pending. Six skeleton rows at row height, `ink.100` / `ink.700`, no shimmer. Appears only past `delay.spinnerOnset` |
| `populated` | As drawn. Scrolled so the current entry is visible with at least one entry above it — landing on the first row tells the reader nothing about where they are |
| `empty` | `getOutline()` resolves to `[]`. `EmptyState`: `No contents` / `This document doesn't include a table of contents. Use search to find a phrase, or turn to a page directly.` Primary: `Search this document` — an empty TOC is exactly when search becomes the answer |
| `entryUnresolved` | `pageNumber === -1`. Row renders the title, no page number, at `chrome.textMuted`. Tappable: it attempts the `uri`. If that fails, a toast reads `That section isn't in this layout` and the panel stays open |
| `failed` | `getOutline()` rejects. Inline row inside the panel: `Contents couldn't be read` + `Try again`. The panel does not become a full-screen error; the reader can still close it and keep reading |
| `jumped` | Panel dismisses, page turns to the target **without a curl** — a 12-page jump is not a page turn and animating it as one is a lie. `motion.crossfade` 150ms. A toast offers `Back to page 214` for 6 seconds |

The `jumped` toast is H3 (user control and freedom) and comes straight from
task 4 of the usability script: a reference reader who loses their page to a TOC
jump has been made worse off by the feature.

---

## 4. Gesture conflicts

- **Sheet drag-down vs list scroll (phone).** Drag-down dismisses only when the
  list is at `scrollY === 0`. Standard bottom-sheet arbitration; stated because
  getting it wrong makes the TOC feel like it is falling off the screen.
- **The page-turn pan is disabled while the panel is open on the Duo.** The left
  leaf shows a live page, and a reader who drags it turns the page under a TOC
  that then points at the wrong current entry. The canvas gets
  `pointerEvents="none"` while the panel is open. The bar's turn buttons are also
  hidden, so there is no route to a turn that would desync the panel.
- **No swipe actions on TOC rows.** An outline entry has exactly one action.

---

## 5. Single vs spread

The TOC lists flat page numbers from `OutlineEntry.pageNumber`, never ranges,
in both modes — an outline entry points at one page. The jump lands on that page
and `PageCurlView` pairs it according to `SpreadPolicy`, which may put the target
on the right-hand leaf. That is correct: the reader asked for the page, not for
the page to be on the left.

On spread, the `jumped` toast reads `Back to pages 214–215`.

---

## 6. Accessibility

- **Depth must be programmatic, not visual** (WCAG 1.3.1). Indentation alone is
  invisible to a screen reader. Every row carries `accessibilityLabel` with the
  level stated: `Level 2. Lockout procedure. Page 14.`
- **Unresolved entries say so**: `Level 2. Torque specifications. No page in this
  layout.` Silence would read as a bug.
- **Current entry**: `accessibilityState={{ selected: true }}` plus the 3dp bar
  plus the fill. Three cues, one non-visual, one non-colour.
- **Focus** moves to the panel title on open and returns to the Contents button
  on dismiss. The phone sheet traps focus; the Duo panel does not, because the
  left leaf is live content the reader may legitimately want to reach.
- **Escape**: system back and `✕` both dismiss. No keyboard trap (2.1.2).
- **Touch targets**: 48dp rows. Where a title wraps to two lines the row grows;
  it never shrinks below 48dp at any font scale.
- **Announce the jump**: `announceForAccessibility('Jumped to page 31, Drive
  coupling')`. The panel closing is not itself an announcement.
- **Reduced motion**: panel fades over 120ms with no translate; the jump is a
  swap with no crossfade.
