# Handoff — search and results

Backed by `MuPDFSource.search(needle, maxHits = 200)`, cancellable, returning
`SearchResult[]` of `{ pageNumber, chapter, page, x0, y0, x1, y1 }`.

Two facts drive this spec:

1. **Results carry coordinates, not text.** A snippet needs a second call to
   `getPageText(pageNumber)` per hit page.
2. **`getPageText` returning empty means the page has no text layer.** That is
   how this screen distinguishes "not in the document" from "this document can't
   be searched", and the engine cannot OCR either way.

---

## 1. Layout

### 1.1 Phone — find bar, not a result list

```
┌──────────────────────────────┐
│                              │
│   page raster, still visible │  match under the bar is scrolled clear
│   ▁▁▁▁▁▁▁                    │  hit.fill + 2dp hit.rule on the match
│   coupling                   │
│                              │
├──────────────────────────────┤
│ ⌕ coupling        ✕  2/107 ∧∨│  56dp find bar, above the keyboard
└──────────────────────────────┘
```

The page stays visible and the reader steps through matches with `∧` / `∨`. The
`2/107` counter is `type.caption` tabular-nums. `✕` clears the query; system back
closes the bar.

### 1.2 Surface Duo, spanned — page on one leaf, results on the other

```
        left leaf 540dp        │hinge│      right leaf 540dp
┌───────────────────────────────┬────┬──────────────────────────────┐
│                               │▓▓▓▓│ ⌕ coupling              ✕    │
│   page raster, live,          │▓▓▓▓│ 107 results                  │
│   current match marked        │▓▓▓▓│──────────────────────────────│
│                               │▓▓▓▓│▌Ch 2 · p31                   │
│                               │▓▓▓▓│ …torque the ▁coupling▁ to…   │
│                               │▓▓▓▓│ Ch 2 · p34                   │
│                               │▓▓▓▓│ …the ▁coupling▁ flange must… │
└───────────────────────────────┴────┴──────────────────────────────┘
```

Field and list on the right leaf, page live on the left. Selecting a result moves
the left leaf to that page and keeps the list in place — the comparison workflow
Tom's task needs. **No scrim.** Spread collapses to single while the panel is
open, same as the TOC.

---

## 2. Tokens

| Element | Token |
| --- | --- |
| Find bar / panel surface | `chrome.raised`, `elevation.raised` |
| `SearchField` | 48dp, `radius.sm`, 1dp `chrome.border` (3.56:1 light, 3.18:1 dark), `type.body` |
| Field label | Visible `Search this document` above the field on the Duo panel; on the phone find bar the leading `⌕` glyph plus `accessibilityLabel` carries it |
| Result count | `type.label`, `chrome.textMuted` |
| Step counter | `type.caption` tabular-nums, `chrome.textMuted` |
| Step buttons | 48 × 48dp, `chrome.text`, `chrome.textDisabled` at the ends |
| Result row | 64dp min, `space.3` vertical |
| Chapter · page | `type.caption` tabular-nums, `chrome.textMuted` |
| Snippet | `type.body`, `chrome.text`, 2 lines max, 68ch measure |
| Match in snippet | `hit.fill` `#FFE08A` light / `#3A3218` dark, plus 2dp `hit.rule` `#7A5A00` / `#D9B24C` |
| Match on the page | Same fill and rule, drawn from the result quad in page coordinates |
| Current result | 3dp `ribbon` leading bar + 8% `ribbon` fill + `selected` |
| Progress during search | 2dp determinate bar under the field, `ribbon`, `pagesScanned / pageCount` |

Contrast on the marked match: `#1A1A18` on `#FFE08A` is **13.51:1**. The
`hit.rule` underline at **6.12:1** on `page.light` and **5.17:1** on
`page.sepia` carries the mark when the fill is not perceivable (WCAG 1.4.1).

---

## 3. States

| State | Behaviour and exact copy |
| --- | --- |
| `idle` | Field focused, keyboard up, no results area. Recent queries for this document, max 3, if any |
| `searching` | Fires on submit, not per keystroke. Determinate bar under the field. Results stream in as they arrive — `search` yields hits progressively. `✕` cancels via the cancellation token, which the engine already supports and tests |
| `results` | `107 results`. List as drawn. Current result marked |
| `resultsCapped` | Exactly `maxHits` hits returned. Count reads `First 200 results` with a second line: `This document has more matches than we show. Try a longer phrase.` A bare `200 results` would be a false number |
| `noResults` — searchable document | `getPageText(currentPage)` returns text. `EmptyState`: `No matches for "coupling"` / `Check the spelling, or try a shorter phrase.` |
| `noResults` — **no text layer** | `getPageText(currentPage)` returns empty across the current page and two sampled pages. `EmptyState`: `This document can't be searched` / `These pages are images — a scan or a comic — with no text behind them. Searching finds words, and there aren't any to find here.` Primary: `Browse the contents instead`. **Copy tested in task 6 of the usability script; if a participant concludes the word is absent from the document, this wording has failed** |
| `cancelled` | Partial results kept and labelled `Stopped after 240 pages · 12 results`. Primary: `Keep searching`. Discarding work the reader has already waited for is the wrong default |
| `failed` | `search` rejects. Inline row: `Search stopped` + the `DocumentError.message` in `type.caption` + `Try again` |

---

## 4. Gesture conflicts

- **The page-turn pan is disabled while search is open on the Duo** — same rule
  as the TOC. The result list's notion of "current" desyncs if the page turns
  underneath it.
- **On the phone find bar the page-turn pan stays live.** The bar covers 56dp at
  the bottom; the page above it is a normal reading surface and a reader who
  swipes it turns the page. The step counter then reads `— / 107` until a match
  is on screen again, which is honest. Locking the page here would be worse:
  the find bar's whole point is staying in the document.
- **Keyboard vs list scroll.** Scrolling the result list dismisses the keyboard
  (`keyboardDismissMode="on-drag"`) and keeps the field's text.
- **No swipe actions on result rows.**

---

## 5. Single vs spread

| | Single | Spread |
| --- | --- | --- |
| Result jump | Lands on the result's page | Lands on the spread containing it; the matched leaf gets the 3dp `ribbon` bar along its outer edge so the reader knows which of the two pages hit |
| Step through matches | Next match anywhere | Next match **outside the current spread** — stepping twice within one visible spread looks like the button did nothing |
| Multiple hits on one page | Stepped individually, page-relative quads | Same |

While a panel is open the reader is in single mode anyway (§1.2), so the spread
column applies to the phone find bar in landscape and to flat-spread tablets.

---

## 6. Accessibility

- **Persistent visible label** on the Duo panel field (WCAG 3.3.2). The phone
  find bar has no room for one; its `accessibilityLabel` is `Search this
  document` and the glyph is `importantForAccessibility="no"`.
- **Result count is a live region.** `accessibilityLiveRegion="polite"` on the
  count line so `107 results` is announced without moving focus (WCAG 4.1.3).
  The search progress bar is **not** a live region — a percentage announced
  every frame is unusable.
- **Result row accessible name**: `Result 2 of 107. Chapter 2, page 31. Torque
  the coupling to sixty newton metres.` Position first, because a screen reader
  user stepping a list needs to know where they are before they hear the text.
- **The match must not be marked by colour alone** (1.4.1) in the snippet or on
  the page: `hit.rule` underline on both, and the accessible name says
  `coupling` is the match by reading the snippet with the term in place.
- **Step buttons** are 48 × 48dp with names `Previous match` and `Next match`,
  not `Up` and `Down` — direction is not the action.
- **Cancel**: `✕` is 48 × 48dp with an `accessibilityLabel` that changes with
  state: `Clear search` when idle, `Stop searching` while a search runs. One
  glyph with two meanings needs two names.
- **Focus** enters the field on open and returns to the Search button on close.
  Selecting a result on the Duo moves focus to the page canvas, whose label then
  carries the page text (see `handoff/reader-canvas.md` §6.1).
- **Text scaling**: snippets cap at 2 lines at default scale and 3 lines above
  150%, then ellipsise. The full snippet is always in the accessible name.
- **Reduced motion**: results appear without stagger. The jump to a result is a
  swap, not a crossfade.
