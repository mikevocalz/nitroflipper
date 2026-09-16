# Handoff — bookmarks

Backed by `MuPDFSource.persistentLocator(index): Promise<string>` and
`pageForPersistentLocator(locator): Promise<number | null>`.

A bookmark stores the ADR-0004 string
`nfl:<version>:<chapter>:<page-in-chapter>:<flat-page-number>`, not a page index.
That is what survives a font-size change, and it is also why a bookmark can fail
to resolve. This screen's hardest job is showing the difference honestly.

---

## 1. Layout

### 1.1 Phone — bottom sheet, 88% height

```
┌──────────────────────────────┐
│ ▓▓▓▓ page still visible ▓▓▓▓ │
├──────────────────────────────┤
│            ────              │
│ Bookmarks                 ✕  │
│ 3 bookmarks                  │  type.caption, chrome.textMuted
├──────────────────────────────┤
│ Page 214             2 days  │  type.body / type.caption
│ "…torque the coupling to…"   │  snippet, 2 lines, chrome.textMuted
│                              │
│ Page 77              1 week  │
│ "…hydraulic circuit test…"   │
│                              │
│ Page 31 · approximate    Sep │  amber dot + word, see §3
│ "Chapter 2 — position may…"  │
└──────────────────────────────┘
```

Rows are 84dp minimum: page line, snippet (2 lines), date. Sorted by page
ascending — a bookmark list is a map of the document, and a reader scanning it
is looking for a place, not a timestamp.

### 1.2 Surface Duo, spanned — side panel on one leaf

Same panel geometry as the TOC: right leaf for LTR, no scrim, page live on the
left leaf, spread collapsed to single while open. Rows gain a 96 × 128dp page
thumbnail on the leading edge, rendered lazily through `readPageScaled` as each
row scrolls into view — never for the whole list.

### 1.3 Creating a bookmark

Not a screen. The reader bar's `⚑` control toggles the current page:

- **Add:** glyph fills, `Toast`: `Bookmarked page 214`, undo for 4s.
- **Remove:** glyph outlines, `Toast`: `Removed bookmark on page 214`, undo for 4s.

The glyph's filled state is the persistent indicator that the current page is
bookmarked, and it carries `accessibilityState={{ checked: true }}`.

---

## 2. Tokens

| Element | Token |
| --- | --- |
| Panel surface | `chrome.raised`, `elevation.raised` |
| Row | 84dp min, `space.3` vertical, `space.4` horizontal |
| Page line | `type.body` tabular-nums, `chrome.text` |
| Snippet | `type.body`, `chrome.textMuted`, 2 lines, 68ch |
| Date | `type.caption`, `chrome.textMuted`, right-aligned |
| Thumbnail (Duo) | 96 × 128dp, `radius.sm`, 1dp `chrome.border`, `page.*` fill while loading |
| `resolved` row | Default |
| `approximate` row | `#8C6B00` (light, 4.03:1 on sepia / 4.64:1 on `chrome.surface`) or `#D9B24C` (dark) dot, 8dp, plus the visible word `approximate` |
| `unresolvable` row | 60% opacity, `alert.600` / `alert.200` dot, visible word `not found` |
| Current page's bookmark | 3dp `ribbon` leading bar + `selected` |
| Delete (swipe) | `alert.600` fill, `#FFFFFF` label — 6.54:1 |
| Toast | `chrome.raised`, `elevation.raised`, 4s, bottom of the active leaf |

---

## 3. Row resolution states

The part no reference app has to handle. Every row resolves its locator through
`pageForPersistentLocator` when the list loads.

| State | Condition | Row shows | Tap does |
| --- | --- | --- | --- |
| `resolved` | Returns a page, and the stored `layoutGeneration` matches the document's current one | `Page 214` | Jumps to 214 |
| `approximate` | Returns a page, but the stored generation differs — the document was re-laid-out at a different font size since | `Page 211 · approximate` + dot + a second line `Saved in chapter 2 at 12 pt` | Jumps to the resolved page and shows a toast: `Text size changed since you saved this — you may be a page either side.` |
| `unresolvable` | Returns `null` | `Page 214 · not found` + dot, row at 60% opacity | Does not jump. Shows a dialog: `This bookmark doesn't match this document` / `It may have been saved from a different copy of the file.` Actions: `Remove bookmark`, `Keep it` |
| `pending` | Resolution in flight | Page line renders from the locator's `<flat-page-number>` field with no state dot; the dot appears when resolution lands | Disabled |

`approximate` is the common case and it is not a failure — ADR-0004's whole
design is that a chapter anchor survives repagination while the exact page does
not. Reporting it as exact would be the lie; hiding it would be worse.

---

## 4. States

| State | Copy |
| --- | --- |
| `empty` | `EmptyState` drawing the actual reader-bar bookmark control at actual size. Headline `No bookmarks in this document`. Body: `Tap ⚑ in the reader controls to mark a page. Bookmarks come back to the same paragraph even after you change the text size.` The second sentence is the non-obvious property and the reason the feature is worth using |
| `populated` | As drawn |
| `loading` | Three skeleton rows past `delay.spinnerOnset` |
| `deleting` | Row collapses over 180ms; toast with undo for 4s. No confirmation dialog — the undo is the safety net (H3) |
| `jumped` | Panel dismisses, `motion.crossfade` 150ms, no curl. Toast: `Back to page 214` for 6s |

---

## 5. Gesture conflicts

- **Swipe-to-delete** is right-to-left in LTR, left-to-right in RTL,
  `activeOffsetX` ±24dp so vertical list scroll wins ties.
- **Page-turn pan disabled while the panel is open on the Duo.** Same rule as
  the TOC: a page turn under an open bookmark list desyncs the current-page
  marker.
- **Long-press unclaimed.** Delete is reachable by swipe and by
  `accessibilityActions`.
- **Sheet drag-down only at `scrollY === 0`** on the phone.

---

## 6. Single vs spread

Bookmarks address one page, never a spread — a locator has one flat page number.
Creating a bookmark in spread mode bookmarks the **leading** page (`pageIndex`,
not `pageIndex + 1`), and the toast says which: `Bookmarked page 214`, so a
reader who wanted 215 can see they did not get it.

Jumping in spread mode lands on the spread containing the page, with the
bookmarked leaf marked by a 3dp `ribbon` bar along its outer edge for 2 seconds.

---

## 7. Accessibility

- **Row accessible name** carries the state in words, never as a dot alone
  (1.4.1): `Page 211, approximate. Saved in chapter 2 at 12 point. Torque the
  coupling to sixty newton metres. Saved 2 days ago.`
- **`unresolvable` rows** are not removed from the accessibility tree — a reader
  needs to reach the row to delete it. `accessibilityState={{ disabled: true }}`
  and the name ends `Not found in this document. Double tap for options.`
- **Delete via `accessibilityActions`**: `[{name:'delete', label:'Delete
  bookmark'}]`. Swipe alone would make deletion unreachable with a screen
  reader (2.5.1).
- **The toggle's state**: `accessibilityState={{ checked }}` on the reader bar's
  `⚑` plus a name that changes — `Bookmark this page` / `Remove bookmark from
  this page`. A control whose name stays constant while its meaning inverts is
  the most common toggle failure.
- **Announce add and remove** via `announceForAccessibility`. The toast alone is
  not announced reliably on Android.
- **Undo must be reachable.** The toast's `Undo` is 48dp and receives focus when
  a screen reader is active, extending the toast to 10s while focused. A 4s undo
  is unusable for someone navigating by swipe.
- **Thumbnails** (Duo) are `importantForAccessibility="no"`; the snippet carries
  the meaning.
- **Focus** enters the panel title and returns to the Bookmarks button on close.
- **Text scaling**: rows grow; the snippet drops to one line above 150% and the
  full text stays in the accessible name.
