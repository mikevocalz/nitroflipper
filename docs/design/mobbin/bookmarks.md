# Mobbin references — bookmarks

Task: mark a place and come back to it. Backed by
`MuPDFSource.persistentLocator(index)` and `pageForPersistentLocator(locator)`,
which return and resolve the versioned string from ADR-0004:
`nfl:<version>:<chapter>:<page-in-chapter>:<flat-page-number>`.

A bookmark stores that string, not a page number. That is what lets it survive a
relayout at a different font size — and it is also why a bookmark can fail to
resolve, which none of the references below have to handle.

## References

1. **MasterClass, My Bookmarks empty** —
   [mobbin.com/screens/f5b8408f-41d5-4910-8ad3-a9f872107f5a](https://mobbin.com/screens/f5b8408f-41d5-4910-8ad3-a9f872107f5a)
   A bordered card containing one muted line: `You haven't added any bookmarks
   yet.` No illustration, no action.
2. **The Atlantic, Saved empty** —
   [mobbin.com/screens/be11d892-94f3-4e86-a718-ca08c5a27b37](https://mobbin.com/screens/be11d892-94f3-4e86-a718-ca08c5a27b37)
   A headline, then a small diagram of the exact row and the exact red bookmark
   icon the reader should tap, then the instruction: `Tap the bookmark icon on a
   story to save it for later.`
3. **Brink, No Saved Articles** —
   [mobbin.com/screens/63476c8d-0a77-41a7-90c8-de4066c6a751](https://mobbin.com/screens/63476c8d-0a77-41a7-90c8-de4066c6a751)
   Centred icon, `type.display` headline, one muted supporting line.
4. **The New Yorker, My Library** —
   [mobbin.com/screens/298f49fb-50d2-4c94-a1dc-5cd820a56df4](https://mobbin.com/screens/298f49fb-50d2-4c94-a1dc-5cd820a56df4)
   `Saved Stories / History` tabs, a drawn illustration, and a sentence that
   states the benefit: `Once you save a story, you can easily revisit it
   here—even off-line.`
5. **Particle News, Bookmarks** —
   [mobbin.com/screens/282116c8-982d-4dc9-a94a-26014a384f96](https://mobbin.com/screens/282116c8-982d-4dc9-a94a-26014a384f96)
   A `?` glyph over the words `No results`.

## Adopted

**Show the reader the control they are looking for (The Atlantic).** The
strongest empty state of the five: it renders the actual icon at the actual size
in the actual position. The bookmark empty state does the same — it draws the
reader bar's bookmark control and says which one it is, because in this app that
control lives in chrome that is hidden by default.

**State the benefit, not just the absence (The New Yorker).** "No bookmarks"
describes the list. "Bookmarks come back to the same paragraph even after you
change the text size" describes why the feature exists, and that is the one
genuinely non-obvious property of a locator-backed bookmark.

**Rows carry a page number and a date (implicit across all five).** Date
distinguishes two bookmarks on the same chapter; page number is what the reader
actually recognises.

## Rejected

**`No results` as empty-state copy (Particle News).** Rejected: "no results"
implies a query was run and came back empty. Nothing was queried — the reader has
not made a bookmark yet. The two states read identically and mean opposite
things, and this screen has both: an empty list and a filtered list that matched
nothing.

**A bare `?` glyph (Particle News).** Rejected: it reads as an error or a missing
asset. An empty bookmark list is a normal state on first run and should not look
like a failure.

**Tabs over the bookmark list (The New Yorker's `Saved / History`).** Rejected:
reading history is not stored. One tab is not a tab.

**A bordered card wrapping the empty message (MasterClass).** Rejected under the
elevation rule in `tokens.md` — a border around a message that is the only thing
on the screen adds a boundary with nothing on the other side of it. The message
sits on the surface.

## What none of the references solve

**A bookmark that no longer resolves.** `pageForPersistentLocator` returns `null`
when the locator does not parse or does not resolve — a different build, a
re-downloaded file, a document whose chapter count changed. ADR-0004 specifies
the fallback order; the UI has to show the result of that fallback honestly. The
handoff spec defines three row states (`resolved`, `approximate`, `unresolvable`)
and what each one does when tapped. No reference here has this problem, because
none of them bookmark a reflowable document that repaginates.
