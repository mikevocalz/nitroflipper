# Handoff — loading state

Covers the gap between choosing a document and the first rendered page.

What happens in that gap, in order:

1. `MuPDFFactory.openDocument(path, password)` — resolves on the executor thread.
2. `pageCount`, `isReflowable`, `format` become readable from the snapshot.
3. Reflowable only: `layout({ width, height, fontSizePt })` paginates the book.
4. `prefetchPageBoxes` fills up to 64 page boxes (`MuPDFSource.prefetchPageBoxes`).
5. `readPageScaled(0, w, h)` rasterises leaf one.
6. Skia decodes the bytes; `PageTextureCache` admits the texture.
7. The shader draws.

**None of this has been timed on a device.** The thresholds below come from the
representation-change rules in `tokens.md` §5.4. The 1200 ms target in
`research.md` is what they should be validated against.

---

## 1. Layout — three representations, by elapsed time

### 1.1 Under `delay.spinnerOnset` (400ms) — nothing

The selector row keeps its pressed state. No overlay, no spinner, no navigation.
A spinner that appears and disappears inside 200ms reads as a glitch.

### 1.2 400ms to `delay.skeletonToProgress` (800ms) — page-shaped skeleton

```
┌──────────────────────────────┐
│ ‹  maintenance-log.pdf       │  real header, 56dp, cancel is live
│                              │
│   ┌──────────────────────┐   │  skeleton at the DOCUMENT's aspect,
│   │                      │   │  from getPageBox(0) — available as soon
│   │░░░░░░░░░░░░░░░░░░░░░░│   │  as openDocument resolves
│   │░░░░░░░░░░░░░░░░░░░░░░│   │
│   │░░░░░░░░░░░░░░░░░░░░░░│   │  ink.100 fill + 1dp chrome.border
│   └──────────────────────┘   │
│                              │
└──────────────────────────────┘
```

Before `getPageBox(0)` resolves, the skeleton uses 1:1.414 (ISO 216), which is
close enough for a PDF and wrong for a comic — it is replaced the moment the real
box arrives, roughly a frame later.

### 1.3 Past 800ms — determinate progress

```
┌──────────────────────────────┐
│ ‹  maintenance-log.pdf       │
│                              │
│   ┌──────────────────────┐   │
│   │░░░░░░░░░░░░░░░░░░░░░░│   │  skeleton stays, no shimmer
│   └──────────────────────┘   │
│                              │
│   Laying out 622 pages       │  type.body, chrome.text
│   ▓▓▓▓▓▓▓▓▓░░░░░░░░░  312/622│  2dp bar + type.caption tabular-nums
│                              │
│              Cancel          │  TextButton 48dp — appears at 6s
└──────────────────────────────┘
```

`pageCount` is readable by this point, so the count is a real number rather than
a guess. The stage label changes with the actual work:

| Stage | Label |
| --- | --- |
| `openDocument` pending | `Opening maintenance-log.pdf` (indeterminate — no count exists yet) |
| `layout` running, reflowable | `Laying out 622 pages` + determinate bar |
| `prefetchPageBoxes` running | `Measuring pages` + determinate bar, capped at 64 |
| `readPageScaled` pending | `Rendering page 1` (indeterminate — one page, no subdivision) |

Past `delay.slowWarning` (6s) a second line appears: `Still opening — large
documents can take a moment`, plus the `Cancel` button.

### 1.4 Surface Duo, spanned

Two skeletons with the fold between them, at the leaf aspect, from the first
frame. The spread decision comes from `shouldUseSpread(viewport, pageBox,
'auto')` and the viewport is known before the document opens — so the reader sees
the spread is going to land correctly before it does. Progress text and the
cancel control dock inside one leaf and never cross the fold.

If `getPageBox(0)` comes back wide enough that `shouldUseSpread` returns false,
the two skeletons collapse to one full-width skeleton over `motion.crossfade`
150ms, before any raster exists.

---

## 2. Tokens

| Element | Token |
| --- | --- |
| Screen surface | `page.*` for the current page theme — the letterbox colour the page will land on, so the transition is a fill, not a jump |
| Skeleton fill | `ink.100` `#ECEEF1` light / `ink.700` `#333944` dark |
| Skeleton outline | 1dp `chrome.border` — the block communicates the page's shape, so its edge must clear 3:1 (1.4.11) |
| Shimmer | **None** |
| Stage label | `type.body`, `chrome.text` |
| Count | `type.caption` tabular-nums, `chrome.textMuted` |
| Progress bar | 2dp, `radius.pill`, `ribbon.700` / `ribbon.300` on `chrome.divider` |
| Slow-warning line | `type.caption`, `chrome.textMuted` |
| Cancel | `TextButton` 48dp, `chrome.text` |
| Skeleton → page | `motion.crossfade` 150ms |
| Spinner (indeterminate stages) | `motion.spinner` 900ms linear, 24dp, `chrome.textMuted` |

---

## 3. States

| State | Behaviour |
| --- | --- |
| `preOnset` | Under 400ms. Nothing |
| `skeleton` | 400–800ms. §1.2 |
| `progress` | Past 800ms. §1.3 |
| `slow` | Past 6s. Warning line + `Cancel` |
| `cancelled` | Returns to the selector. The row shows `Cancelled` for 4s. `close()` is called on the partially-opened document — `MuPDFSource.close()` is idempotent and tested |
| `ready` | First raster admitted to the cache. Skeleton crossfades to the page over 150ms. **The skeleton must not disappear before the texture is drawable**, or the reader gets a frame of empty letterbox |
| `failed` | Routes to `handoff/error.md` with the parsed `DocumentErrorKind` |
| `needsPassword` | Routes to `handoff/password.md`. The loading screen does not flash an error first |

**Never a full-screen skeleton for a page turn.** An uncached destination holds
the current page, lets the curl run, and — if the raster has not arrived by the
end of the curl — switches `PageLabelChip` to an inline indicator. Covering the
book because one page is slow is the wrong scale of response.

---

## 4. Gesture conflicts

Nothing here is draggable, so there is nothing to arbitrate. Two rules anyway:

- **Back is live from the first frame.** System back and the header's `‹` both
  cancel the open. A load the reader cannot escape is the worst version of this
  screen.
- **The page-turn pan is not attached until the source is non-null.**
  `PageCurlView` does not mount during loading, so a swipe on the skeleton does
  nothing — correct, and it needs to stay that way when the skeleton moves
  inside the reader's own view tree.

---

## 5. Single vs spread

The spread decision is made and shown before the document opens, from the
viewport alone. §1.4 covers the correction when the real page box disagrees.

The key ordering: decide spread → draw skeletons → open document → correct if
needed → render. Waiting for the document to decide the layout means an extra
800ms of blank screen for information the viewport already had.

---

## 6. Accessibility

- **Status is announced, focus does not move** (WCAG 4.1.3).
  `accessibilityLiveRegion="polite"` on the stage label. The *label* is the live
  region, not the count — announcing `313 of 622`, `314 of 622` on every frame is
  unusable. The count is read on demand when focus reaches it.
- **Announce stage changes only**: `Laying out 622 pages`, then `Rendering page
  1`, then `Page 1 of 622 ready`. Three announcements for a two-second open.
- **The skeleton is not in the accessibility tree.**
  `importantForAccessibility="no-hide-descendants"` on the blocks; the container
  carries one name: `Opening maintenance-log.pdf.`
- **Progress semantics**: `accessibilityRole="progressbar"` with
  `accessibilityValue={{ min: 0, max: 622, now: 312, text: '312 of 622 pages' }}`
  on the determinate stages. Indeterminate stages omit `now` rather than sending
  a fake value.
- **Cancel is reachable and focusable** from the moment it appears, and it is the
  first focusable element after the header.
- **Reduced motion**: no spinner rotation — the indeterminate indicator becomes a
  static glyph with the stage label carrying the meaning. The determinate bar
  still fills, because that is information rather than decoration. The skeleton →
  page crossfade becomes a swap.
- **Text scaling**: the stage label wraps rather than truncating. The skeleton
  shrinks to make room, down to a floor of 40% of the letterbox height, below
  which it is dropped entirely and the text stands alone.
