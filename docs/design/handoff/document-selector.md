# Handoff — document selector

Entry point. Produces a filesystem path and hands it to `MuPDFSource.open()` or
`createComicArchiveSource().open()`.

Replaces the `const FORMAT: 'cbz' | 'pdf' | 'epub' = 'epub'` switch in
`example/App.tsx`, which requires a rebuild to change document.

---

## 1. Layout

### 1.1 Phone, portrait — 412 × 915dp

```
┌──────────────────────────────┐
│ Library                      │  type.display, space.6 top, space.4 side
│                              │
│ Recent                       │  type.label, chrome.textMuted, space.8 above
│ ┌──────────────────────────┐ │
│ │[PDF] Drive coupling …    │ │  72dp row
│ │      Page 214 of 622 · 2d│ │
│ │      ▓▓▓▓▓▓░░░░░░░ 8.4 MB│ │  2dp progress bar
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │[EPUB] The Blue Notebook  │ │
│ │       Not started · 1.1MB│ │
│ └──────────────────────────┘ │
│                              │
│ ╭──────────────────────────╮ │
│ │   Open a document…       │ │  PrimaryButton, 48dp, space.6 above
│ ╰──────────────────────────╯ │
└──────────────────────────────┘
```

Row anatomy, left to right: `FormatBadge` (fixed 48dp column) — filename
(`type.body`, one line, middle-ellipsis so the extension survives) — chevron.
Second line `type.caption` `chrome.textMuted`: position · size · relative date.
Third line, only when position > 0: a 2dp progress bar, full row width,
`ribbon.700` on `chrome.divider`.

Middle-ellipsis, not tail: `equipment-manual-rev-C-2024.pdf` and
`equipment-manual-rev-D-2024.pdf` are distinguished by a character near the end.

### 1.2 Surface Duo, spanned — 1080 × 720dp

Two-column, split **at the fold**, which is the only place a Duo layout may
split:

```
        left leaf 540dp        │hinge│       right leaf 540dp
┌───────────────────────────────┬────┬──────────────────────────────┐
│ Library                       │▓▓▓▓│  Drive coupling service…     │
│                               │▓▓▓▓│  PDF · 8.4 MB · 622 pages    │
│ Recent                        │▓▓▓▓│  ┌────────────────────┐      │
│ ▸ [PDF]  Drive coupling…  ✓   │▓▓▓▓│  │                    │      │
│   [EPUB] The Blue Notebook    │▓▓▓▓│  │   page 1 preview   │      │
│   [CBZ]  MMPR #1              │▓▓▓▓│  │                    │      │
│                               │▓▓▓▓│  └────────────────────┘      │
│ ╭───────────────────────────╮ │▓▓▓▓│  Last read: page 214, 2 days │
│ │   Open a document…        │ │▓▓▓▓│  ╭────────────────────────╮  │
│ ╰───────────────────────────╯ │▓▓▓▓│  │  Continue from page 214│  │
│                               │▓▓▓▓│  ╰────────────────────────╯  │
└───────────────────────────────┴────┴──────────────────────────────┘
```

List on the left leaf, detail on the right. Side margins `space.12` (48dp) at the
outer edges, `fold.safeInset` (24dp) at the hinge. **No row, button or label
crosses the fold.**

The right-leaf preview renders page 1 through `readPageScaled` at leaf size —
one page, on selection, not twenty on list load.

`Continue from page 214` resolves through `pageForPersistentLocator`. When the
locator does not resolve the button reads `Open`, and the reason is in the
bookmark-row state table in `handoff/bookmarks.md` §3.

---

## 2. Tokens

| Element | Token |
| --- | --- |
| Screen surface | `chrome.surface` |
| Screen title | `type.display` 28/34, `chrome.text` |
| Section header | `type.label` 14/20, `chrome.textMuted` — 7.44:1 light, 8.48:1 dark |
| Row height | 72dp min (grows with font scale), `space.4` horizontal padding |
| Row separator | `chrome.divider`, 1dp, inset `space.4 + 48dp` so it starts at the filename |
| Filename | `type.body`, `chrome.text` |
| Metadata | `type.caption`, `chrome.textMuted`, tabular-nums |
| `FormatBadge` | `type.caption` 600, 1dp `chrome.border`, `radius.sm`, 4dp × 6dp padding, `chrome.textMuted` label |
| Progress bar | 2dp, `radius.pill`, `ribbon.700` (light/sepia) or `ribbon.300` (dark) on `chrome.divider` |
| Selected row (Duo) | 3dp `ribbon` leading bar + `ribbon` at 8% row fill + `accessibilityState={{ selected: true }}` |
| Row pressed | `chrome.raised` fill, `motion.press` 90ms |
| Primary button | 48dp, `radius.md`, `ribbon.600` fill / `#F6F7F9` label — 4.89:1 |

`FormatBadge` is text, not a coloured dot. `PDF` / `EPUB` / `CBZ` read in
greyscale and read aloud.

---

## 3. States

| State | Copy and behaviour |
| --- | --- |
| `firstRun` | `EmptyState`. Icon, `No documents yet`, `Open a PDF, EPUB or CBZ from your device. It stays on your device — nothing is uploaded.` Primary: `Open a document…`. The privacy line is true and is the one thing a reader wonders about a file picker |
| `hasRecents` | As drawn |
| `picking` | System picker. Filter from `supportedDocumentExtensions()` plus `cbz`, `cbr`. No custom browser |
| `opening` | Row shows an inline 16dp indeterminate indicator after `delay.spinnerOnset`; the rest of the list stays interactive. Full-screen handover happens only once `openDocument` resolves — see `handoff/loading.md` |
| `openFailed` | Row gains a 1dp `alert.600` left bar and a second line in `alert.600`: `Didn't open — tap for details`. Tap goes to `handoff/error.md`. **The list is never replaced by an error screen**; one bad file must not hide the other five |
| `needsPassword` | `DocumentError.needsPassword` is true → `handoff/password.md`. The row keeps a padlock glyph afterwards so the reader knows before tapping |
| `missingFile` | A recent whose path no longer resolves: row at 60% opacity, `File moved or deleted`, swipe or long-press to remove. Tapping re-opens the picker pre-filtered to that extension |

---

## 4. Gesture conflicts

Vertical list scroll is the only scroll on this screen and there is no
competing horizontal gesture, so no arbitration is needed here. Two constraints
that exist anyway:

- **Swipe-to-remove is right-to-left in LTR and left-to-right in RTL**, with
  `activeOffsetX` of ±24dp — double the reader canvas's 12dp, because a list
  scroll and a row swipe share a surface and the scroll should win ties.
- **Long-press is unclaimed here too.** Remove is reachable by swipe and by the
  row's `accessibilityActions`, which is the route a screen reader user needs
  and a long-press would not give them.

---

## 5. Single vs spread

Not a spread screen — it shows no pages. On a spanned Duo it is a two-column
master/detail split at the fold; everywhere else it is one column. Unspanned on
a single Duo screen (540 × 720dp) it is the phone layout.

---

## 6. Accessibility

- **Row accessible name** reads in the order a reader needs it:
  `Drive coupling service manual. PDF, 8.4 megabytes, 622 pages. Page 214 of 622,
  34 percent. Last opened 2 days ago.` Not the visual order — format first would
  make every row start with the same word.
- `accessibilityRole="button"`, not `link`. It opens a document in place.
- **Row actions** via `accessibilityActions`: `[{name:'remove', label:'Remove
  from recents'}]`.
- **Progress is never colour-only** (1.4.1): the percentage is in the accessible
  name and `Page 214 of 622` is visible text.
- **Touch targets:** 72dp rows exceed `target.min`. The chevron is decorative,
  `importantForAccessibility="no"` — the whole row is the target.
- **Focus order:** title → section header → rows in visual order → primary
  button. On the Duo, the list leaf is traversed fully before the detail leaf.
- **Text scaling:** rows have a minimum height, not a fixed one. At 200% the
  metadata line wraps to two and the row grows to roughly 116dp. The filename
  stays one line with middle-ellipsis; the full name is in the accessible name.
- **Announce the result of a removal** via `announceForAccessibility`:
  `Removed The Blue Notebook from recents.` Removing a row silently leaves a
  screen reader user with no confirmation and a changed list.
