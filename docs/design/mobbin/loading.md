# Mobbin references — loading state

Task: cover the gap between choosing a document and the first rendered page.

What actually happens in that gap, in order: `MuPDFFactory.openDocument(path)`
resolves on the executor thread → `pageCount` and `isReflowable` become readable
→ for a reflowable document, `layout({ width, height, fontSizePt })` runs a full
pagination pass → `prefetchPageBoxes` fills up to 64 page boxes →
`readPageScaled` rasterises leaf one → Skia decodes it → the shader draws.

Nothing here has been timed on a device. The thresholds below come from the
representation-change rules in `tokens.md` §5.4, not from measurement.

## References

1. **Grab** —
   [mobbin.com/screens/7c2679a0-c95a-453d-8a53-f3cdd9ea649f](https://mobbin.com/screens/7c2679a0-c95a-453d-8a53-f3cdd9ea649f)
   Skeleton blocks in the exact positions and proportions of the content that
   will replace them — search bar, two cards, an icon grid.
2. **AllTrails** —
   [mobbin.com/screens/a6a7bb97-d19a-410e-94cc-9473cbeeb39b](https://mobbin.com/screens/a6a7bb97-d19a-410e-94cc-9473cbeeb39b)
   A large image-shaped block over three progressively shorter text lines, which
   is the shape of a real card.
3. **YouTube** —
   [mobbin.com/screens/03993244-10ef-4567-861b-092fa81694e9](https://mobbin.com/screens/03993244-10ef-4567-861b-092fa81694e9)
   The player area renders as solid black immediately while the metadata below it
   stays skeletal — the container that is certain resolves first.
4. **OKX** —
   [mobbin.com/screens/842c1739-0e58-4e42-9a13-33d7eb1003d7](https://mobbin.com/screens/842c1739-0e58-4e42-9a13-33d7eb1003d7)
   Very low-contrast grey blocks with no shimmer and no spinner.
5. **Shop** —
   [mobbin.com/screens/d3158271-a0e5-4672-bea0-44ef4aebcb1c](https://mobbin.com/screens/d3158271-a0e5-4672-bea0-44ef4aebcb1c)
   Skeleton content with the real, fully-rendered tab bar still in place.

## Adopted

**Skeleton in the shape of the thing being loaded (Grab, AllTrails).** The reader
tapped a document; the loading state should already look like a page. A
page-shaped rectangle at the *document's own aspect ratio* — available from
`getPageBox(0)` as soon as `openDocument` resolves, before any raster exists.

**Resolve the certain container first (YouTube).** The leaf geometry, the spread
decision and the letterbox are known from the viewport before the document opens.
Those are drawn immediately. Only the page raster is skeletal. On a spanned Duo
that means two page-shaped blocks with the fold between them from the first
frame, so the reader can see the spread is going to land correctly before it
does.

**Keep real chrome real (Shop).** The reader bar and the back control are not
skeletons. They work during the load, which is what makes cancelling possible.

**No shimmer (OKX).** A looping shimmer is motion with no information in it, it
has to be suppressed under reduced motion anyway, and it competes with the one
piece of motion that matters here.

## Rejected

**Skeleton as the only state, however long it takes (all five references).**
Rejected: every reference assumes a network fetch of roughly a second. Opening a
420-page PDF and paginating a reflowable EPUB are not that. Past
`delay.skeletonToProgress` (800ms) the state changes representation — the
skeleton is replaced by a determinate progress row naming the document and the
work in progress (`Laying out 622 pages`), because `pageCount` is readable by
then and a count is real information a skeleton cannot convey.

**A bare spinner from frame one (the common alternative).** Rejected: below
`delay.spinnerOnset` (400ms) the correct state is nothing at all. A spinner that
appears and disappears inside 200ms reads as a glitch. The current example shows
`ActivityIndicator` plus `Loading EPUB…` immediately, which is the pattern being
replaced.

**Very low contrast skeleton blocks (OKX).** Rejected as specified: OKX's blocks
sit around 1.05:1 against their background, which is invisible on a phone at
arm's length outdoors. Skeleton fill is `ink.100` on light and `ink.700` on dark,
and the page-shaped block keeps a 1dp `chrome.border` outline so its edge is
above 3:1 — it is communicating the page's shape, so it has to be perceivable.

**Reusing the skeleton for a page turn.** Rejected: a turn whose destination is
not cached must not flash a skeleton, because the curl is already showing the
reader that something is happening. The uncached case holds the current page and
lets the curl run; if the destination has not arrived by the end of the curl, the
page-label chip switches to an inline progress state. Never a full-screen
skeleton mid-book.
