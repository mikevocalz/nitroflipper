# Mobbin references — reader canvas with controls

Task: read. The canvas is `PageCurlView`; this file is about what sits on top of
it and when.

## References

1. **Apple Books, controls revealed** —
   [mobbin.com/screens/deb26c2b-9819-41c6-8d6a-bb53b14ed2c4](https://mobbin.com/screens/deb26c2b-9819-41c6-8d6a-bb53b14ed2c4)
   Tap reveals a stacked menu — `Contents • 0%`, `Search Book`, `Themes &
   Settings` — over a row of circular actions, with `1 of 622` below it and
   `4 pages left in chapter` at the top.
2. **ElevenReader, reader menu sheet** —
   [mobbin.com/screens/c49f78b5-dfae-46e4-9ffd-5dc410d43976](https://mobbin.com/screens/c49f78b5-dfae-46e4-9ffd-5dc410d43976)
   A bottom sheet carrying the book title, three icon-and-label tiles
   (`Search`, `Voice Chat`, `Sleep timer`) and a list below them: `Hide text`,
   `Bookmarks`, `Preferences`, `Contents`.
3. **Speechify document view** —
   [mobbin.com/screens/acc099dc-54d3-4459-96db-29d787602b89](https://mobbin.com/screens/acc099dc-54d3-4459-96db-29d787602b89)
   A rendered PDF page with a `2 of 2` chip pinned over the lower-right corner of
   the page itself, and a collapse chevron beside it.
4. **Mesh document view** —
   [mobbin.com/screens/39121161-f9bd-4b7a-88f5-897ffca28da1](https://mobbin.com/screens/39121161-f9bd-4b7a-88f5-897ffca28da1)
   An explicit `TURN PAGE →` pill in the lower-right corner. The whole reader
   chrome is that one control.
5. **Obsidian mobile** —
   [mobbin.com/screens/53217838-d7d2-48b8-9c36-30aa3ce9978b](https://mobbin.com/screens/53217838-d7d2-48b8-9c36-30aa3ce9978b)
   A persistent bottom bar with back, forward, search, new, tab count and menu —
   navigation that never hides.

## Adopted

**Tap to reveal, everything hidden by default (Apple Books).** Nadia's and
Kofi's tasks both want the page uninterrupted. The current example inverts this:
chrome starts visible and hides on tap. Flipping the default costs one tap on
entry and returns the whole leaf for the rest of the session.

**A page label that persists when the rest of the chrome is hidden (Speechify's
`2 of 2` chip).** Status has to survive the chrome hiding, or a reader who has
dismissed the bar has no way to know a turn registered. The chip is the minimum
viable H1 signal: `type.caption`, tabular-nums, `page.*`-derived colour so it
sits on the letterbox rather than on artwork.

**An explicit turn control that is a real button (Mesh's `TURN PAGE`).** Mesh
makes it the entire interface, which is more than this reader needs, but it
proves the point the accessibility spec requires: the curl is the animation of a
turn, and the button is an equally first-class way to cause one. The existing
`turnRequest` prop already routes a button press through the same animation path
as a drag, so this costs no new machinery.

**Four named destinations, not a grab bag (Apple Books: Contents, Search,
Themes).** The reader bar carries exactly Contents, Search, Bookmarks and
Appearance. Every one of them maps to a `MuPDFSource` method that exists.

## Rejected

**The stacked overlay menu (Apple Books).** Rejected: it lands in the vertical
middle of the screen, which on a spanned Surface Duo is exactly where the fold
is. Chrome that crosses the hinge is bisected by glass. The spec docks a bar to
the bottom of one leaf instead.

**A full bottom sheet as the primary reader menu (ElevenReader).** Rejected: it
covers roughly half the page to offer four destinations. Four targets fit in a
56dp bar. ElevenReader needs the sheet because it also carries voice, sleep timer
and download; this reader has none of those.

**Always-visible navigation (Obsidian).** Rejected for the comics task. A
persistent bar over a full-bleed comic page costs the reader the bottom 56dp of
every panel for a control they use once a chapter.

**Translucent chrome over the page (ElevenReader, Apple Books, and the current
`ReaderChrome` at `rgba(20,20,20,0.82)`).** Rejected: a translucent surface over
an unknown raster has an unknown contrast ratio. A comic panel with a pale sky
behind the bar puts the label under 4.5:1 and nothing in the code detects it.
The bar is opaque; hiding it is what gets the page back, not seeing through it.

**Reading-progress prose at the top of the page (`4 pages left in chapter`,
Apple Books).** Rejected as a default: it is computed per relayout and, on a
fixed-layout comic, "pages left in chapter" is meaningless. Available in the
page-label chip's expanded form for reflowable documents only.
