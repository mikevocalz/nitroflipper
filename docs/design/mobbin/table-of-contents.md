# Mobbin references — table of contents

Task: jump to a named place. Backed by `MuPDFSource.getOutline()`, which returns
a flat `OutlineEntry[]` carrying `title`, `depth`, `uri`, `pageNumber`,
`chapter` and `page`. `pageNumber` is `-1` when the entry does not resolve in the
current layout — a state every reference below ignores and this screen must not.

## References

1. **Apple Books contents** —
   [mobbin.com/screens/3f69946c-6ee0-499d-970f-2858d5e846d2](https://mobbin.com/screens/3f69946c-6ee0-499d-970f-2858d5e846d2)
   A header carrying the cover thumbnail, title and `Page 1 of 622`, then a flat
   list of chapter titles with right-aligned page numbers.
2. **Fable contents** —
   [mobbin.com/screens/a52dd380-49fa-4ad8-9e61-dad04a724cb5](https://mobbin.com/screens/a52dd380-49fa-4ad8-9e61-dad04a724cb5)
   `Contents / Highlights / Notes / Tabs` tabs over the list; the current chapter
   is tinted and sits at the top; a full-width `Done` button pinned at the bottom.
3. **ElevenReader contents** —
   [mobbin.com/screens/807a9a64-1522-464b-b4b8-7852703450c8](https://mobbin.com/screens/807a9a64-1522-464b-b4b8-7852703450c8)
   Chapter title with a duration underneath, and a play triangle marking the
   current chapter.
4. **Speechify table of contents** —
   [mobbin.com/screens/7160c419-5e21-4f19-9e39-d9f24357e4cd](https://mobbin.com/screens/7160c419-5e21-4f19-9e39-d9f24357e4cd)
   Two-level hierarchy shown by indentation; the current section is a tinted
   band; page numbers appear only on entries that have one.
5. **Finimize inline contents** —
   [mobbin.com/screens/6aef933a-e3de-4ae3-bd63-c06cdb6e99af](https://mobbin.com/screens/6aef933a-e3de-4ae3-bd63-c06cdb6e99af)
   A numbered, collapsible contents block with the current item in the accent
   colour and the rest in muted grey.

## Adopted

**Indentation for depth, page number right-aligned (Speechify, Apple Books).**
`OutlineEntry.depth` maps directly to `depth × 16dp` of leading inset. A PDF
outline is often four levels deep; indentation is the only cue that scales
without wrapping the title.

**Page number shown only when it exists (Speechify).** `pageNumber === -1` means
the entry does not resolve in this layout. Rendering `-1`, or `0`, or a blank
gap, all mislead. The row shows the title alone and the tap target still
resolves through the `uri` if it can — the handoff spec says exactly what happens
when it cannot.

**Current chapter marked and scrolled into view (Fable, Speechify).** Tom opens
the TOC from somewhere in the document and needs to see where he already is
before choosing. Ribbon-tinted row plus a 3dp leading bar plus
`accessibilityState={{ selected: true }}` — three cues, one of them not colour.

**Document title and position in the panel header (Apple Books).** On a spanned
Duo the TOC occupies one leaf while the page stays on the other, so the header is
a redundancy the reader can ignore. On a phone it covers the page entirely, and
the header is the only thing telling them which document they are navigating.

## Rejected

**Tabs across Contents / Highlights / Notes / Bookmarks (Fable).** Rejected:
highlights and notes require text selection, which is not implemented. Three of
four tabs would be permanently empty and would advertise features that do not
exist. Bookmarks gets its own entry in the reader bar instead.

**Per-chapter duration (ElevenReader).** Rejected: it is an audio metric. The
reading-time equivalent would need a words-per-page estimate, and
`ReflowablePaginator`'s character-count estimator is already documented as
something to remove from the production path — reviving it to decorate a TOC row
is the wrong direction.

**Auto-numbering entries (Finimize's `1. 2. 3.`).** Rejected: PDF and EPUB
outlines carry their own numbering inside `title`, frequently in roman numerals
or with a part prefix. Adding a second sequence produces `1. II: Father and Son`.

**A pinned full-width `Done` button (Fable).** Rejected on the Duo: it eats 64dp
from a panel that is already the full height of a leaf, to duplicate the close
control in the header and the system back gesture. Kept on the phone layout,
where the TOC is a sheet and a large dismiss target is the fastest exit.
