# Mobbin references — appearance and text size

Task: change how the page looks. Backed by `MuPDFSource.relayout(layout)` with a
`DocumentLayout { width, height, fontSizePt }`, and `setStyle(style)` with a
`DocumentStyle { usePublisherStyles, userCss }`.

Two constraints no reference has to deal with:

- **Every change is a relayout.** It bumps `layoutGeneration`, invalidates the
  whole texture cache, and re-paginates the book. It is not a CSS variable flip.
- **The page theme only applies to reflowable documents.** A PDF or CBZ page is a
  raster; tinting it sepia stains the scan and inverting it for dark mode
  destroys figure legends.

## References

1. **Apple Books, Themes & Settings** —
   [mobbin.com/screens/a83c87b2-ce0a-450a-a685-eef410d5628b](https://mobbin.com/screens/a83c87b2-ce0a-450a-a685-eef410d5628b)
   A sheet over the still-visible page: two `A` size buttons, a page-style and a
   contrast toggle, a brightness slider, then six named theme tiles
   (`Original`, `Quiet`, `Paper`, `Bold`, `Calm`, `Focus`) each rendering `Aa` on
   its own background, and a `Customise` row.
2. **ElevenReader, Player Preferences** —
   [mobbin.com/screens/8e37d1cb-1111-425f-af10-0849b38a8d93](https://mobbin.com/screens/8e37d1cb-1111-425f-af10-0849b38a8d93)
   A font row naming `Atkinson Hyperlegible`, a size slider labelled
   `Smallest — 28pt — Largest`, theme tiles that preview three real lines of set
   text with highlights, and `Reset` beside `Save settings`.
3. **Substack, Display Settings** —
   [mobbin.com/screens/8f219955-1980-4cf8-aac2-840eea740d4d](https://mobbin.com/screens/8f219955-1980-4cf8-aac2-840eea740d4d)
   Named font choices as a horizontal row of labelled buttons, and text size as
   three discrete buttons — `Smaller`, `Default`, `Bigger` — with the current
   delta stated as `1 PT LARGER`.
4. **Matter, reader settings** —
   [mobbin.com/screens/c9f61846-1003-48cf-acc9-df7c8c970ddc](https://mobbin.com/screens/c9f61846-1003-48cf-acc9-df7c8c970ddc)
   A dense panel: theme dropdown, four named dark variants, brightness slider,
   font, size, spacing and width — each as a paired smaller/larger control.
5. **Blinkist, floating type popover** —
   [mobbin.com/screens/59c25ef7-b6d3-414b-b736-421f755abc6c](https://mobbin.com/screens/59c25ef7-b6d3-414b-b736-421f755abc6c)
   A small popover anchored at the top: four colour circles and one
   `Aa —•— Aa` slider, over a page that stays fully readable.

## Adopted

**Theme tiles that render real text on the real background (Apple Books,
ElevenReader).** A colour swatch shows you the background; a tile showing set
type shows you the contrast, which is the thing being chosen. Each swatch is
56 × 72dp and renders `Aa` in that theme's body colour on that theme's page
colour — the three pairs and their measured ratios are in `tokens.md` §3.2.

**Discrete size steps with the value stated (Substack).** `fontSizePt` is a
number the engine lays out against, and the steps are the sizes the anchor
round-trip is tested at. A stepper makes each change one relayout; a continuous
slider makes it dozens, each invalidating the texture cache mid-drag. The spec
uses a minus / value / plus stepper showing `12 pt`.

**Keep the page visible behind the sheet (Apple Books, Blinkist).** The reader is
judging the change against their own book at their own line length. A settings
screen that covers the page makes them commit blind, then dismiss, then judge,
then reopen. On a spanned Duo the panel takes one leaf and the page keeps the
other — the best version of this, and the only layout where it is free.

**A named reset (ElevenReader's `Reset`).** Four coupled controls make it easy to
end up somewhere unreadable, and a reader who has made the text illegible cannot
read the control that would fix it. Reset is a labelled row at the bottom of the
panel, always at the same place.

## Rejected

**An in-app brightness slider (Apple Books, Matter).** Rejected: it duplicates a
system control that is already one swipe away and, on Android, requires holding a
window attribute that fights every other app's expectations. The three page
themes cover the actual need.

**Font family choice (ElevenReader, Substack, Matter).** Rejected: MuPDF resolves
fonts from the document plus its own base-14 set, and the release tarball
pre-generates only the urw base-14 — every other family is converted at configure
time. Offering `Atkinson Hyperlegible` means shipping and embedding it. Worth
doing for dyslexia support; it is marked **Aspirational** and is not in the
component inventory.

**Line spacing and measure width controls (Matter).** Rejected for now: both are
`userCss` one-liners and both are real relayouts, so each added control
multiplies the relayout surface that has to be tested against the anchor
round-trip. Two controls that provably preserve the reader's place beat five that
have not been checked.

**`Save settings` as an explicit commit (ElevenReader).** Rejected: every control
here is previewed live against the reader's own page. A save button implies the
preview was not the real thing.

**Six named themes (Apple Books).** Rejected: `Quiet`, `Calm` and `Focus` are not
distinguishable by name, and each additional page theme is another set of
contrast pairs to measure and maintain. Three themes, named for what they are.
