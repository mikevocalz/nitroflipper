# Mobbin references — document selector

Task: pick a local PDF, EPUB or CBZ and open it. No accounts, no store, no cloud.
The selector's only job is to get a file path into `MuPDFSource.open()` or
`createComicArchiveSource()`.

## References

1. **Apple Files-style picker, as embedded by Speechify** —
   [mobbin.com/screens/665831f9-8fca-48ac-b4c5-9670f7e73b3b](https://mobbin.com/screens/665831f9-8fca-48ac-b4c5-9670f7e73b3b)
   System document picker: Recents / Shared / Browse tabs, file thumbnails with
   name, date and byte size.
2. **OpenPhone file picker** —
   [mobbin.com/screens/04c3ef88-f825-4297-b030-dc94bf749b65](https://mobbin.com/screens/04c3ef88-f825-4297-b030-dc94bf749b65)
   The same picker with a PDF selected: a blue check badge on the tile and the
   filename in a selected pill.
3. **Fable library** —
   [mobbin.com/screens/e1cfbb38-b6ec-42f0-bba4-919cb141a4fa](https://mobbin.com/screens/e1cfbb38-b6ec-42f0-bba4-919cb141a4fa)
   Cover grid, `0%` progress under each cover, overflow dots per item.
4. **Speechify library** —
   [mobbin.com/screens/f6efeac4-9b11-4024-9b6a-15686274a2de](https://mobbin.com/screens/f6efeac4-9b11-4024-9b6a-15686274a2de)
   `All Files` / `Books` segmented tabs over one grid, with a text progress state
   per item: `Finished`, `0%`, `16%`.
5. **Blinkist My Library** —
   [mobbin.com/screens/7cec730b-97f5-48c2-9ccb-4846a2d8ef69](https://mobbin.com/screens/7cec730b-97f5-48c2-9ccb-4846a2d8ef69)
   An "In progress" row pinned above everything else, plus a persistent
   `Continue reading — 12 Rules For Life` bar at the bottom of the screen.

## Adopted

**Recent documents above the file browser (Blinkist's "In progress" row).**
Tom reopens the same six manuals. Making him re-navigate a file tree each time is
the single largest avoidable cost in his task. The recent list is the default
view; the system picker is one button away.

**Progress as text, not only as a bar (Speechify).** `Page 214 of 622` is
actionable in a way that a 34%-filled bar is not, and it survives greyscale,
which a bar relying on fill colour does not. The spec shows both: a 2dp bar for
glanceability plus the count in `type.caption` tabular-nums.

**Byte size and modified date on every row (Files / OpenPhone).** Two sideloaded
PDFs frequently share a name and differ by revision. Size and date are how the
reader tells them apart, and they cost nothing to display because the filesystem
already has them.

**The system document picker for anything not recent (Speechify).** Building a
file browser inside an example app is work that proves nothing about the library.
The picker also gets scoped-storage permissions right, which a hand-rolled
browser on Android would not.

## Rejected

**The cover grid (Fable, Speechify, Headway).** Rejected: covers require decoding
page 1 of every document at thumbnail size on the selector's first frame. Cover
extraction is not implemented, and for a 20-item list it would rasterise twenty
pages before the reader has chosen one — `renderPage` already rasterises twice
per call. A text list with a format badge opens instantly and says more. If
covers arrive later they can replace the badge without moving anything else.

**Per-item overflow menus (Fable's `•••`).** Rejected: the only actions available
are "remove from recents" and "open". A swipe-to-remove plus a tap covers both
without adding a 44dp target to every row and a menu to every row's a11y tree.

**Segmented `All Files` / `Books` tabs (Speechify).** Rejected: the whole list is
documents. A filter that never filters anything is a control the reader has to
evaluate and dismiss on every visit. If the recent list grows past roughly 30
items, a format filter chip row earns its place — not before.

**A persistent "Continue reading" bar (Blinkist).** Rejected for the selector,
adopted in spirit elsewhere: the selector already opens with the most recent
document at the top of the list, so a second control pointing at the same
document duplicates it. The value in Blinkist's bar is being reachable from
*other* screens, which an example app with one screen level does not need.
