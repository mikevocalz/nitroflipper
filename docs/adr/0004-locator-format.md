# ADR-0004: A versioned chapter-anchored locator, which is not an EPUB CFI

Status: accepted
Date: 2026-09-16

## Context

A reading position has to survive font-size changes, rotation, single/spread
transitions, and being reopened days later in a newer build. A page index does
not survive any of those in a reflowable document. A percentage survives them
only approximately, and drifts differently at each font size.

MuPDF offers `fz_make_bookmark`/`fz_lookup_bookmark`, which resolve correctly
across a relayout. They are opaque values tied to the open document, so they
solve the in-session problem and cannot be persisted.

## Decision

Two mechanisms, for two different jobs.

**In session:** `fz_bookmark`, through `makeBookmark()` / `resolveBookmark()`.
This is MuPDF's own anchor and it is what preserves the position across a
font-size change. Its lifetime is the open document; it is never serialized.

**Persisted:** a versioned string,

    nfl:<version>:<chapter>:<page-in-chapter>:<flat-page-number>

Resolution order, implemented in `locationFromLocator`:

1. Reject anything that does not parse, and anything whose version is not the
   current one. A future version is refused rather than reinterpreted under v1
   rules.
2. Try the chapter anchor. `fz_page_number_from_location` returns -1 when the
   current layout has no such location, which is precisely the "that chapter is
   gone" case.
3. Fall back to the flat page number, clamped into range.

The flat index is a fallback, not the identity. It exists for documents whose
chapter structure changed between versions of the file.

## This is not an EPUB CFI

It must not be described as one, in code, docs, or UI. An
[EPUB CFI](https://w3c.github.io/epub-specs/epub33/epubcfi/) addresses a point
inside the spine item's DOM and is interoperable between readers. This addresses
a MuPDF chapter and page and is meaningful only to this engine.

A real CFI would need the spine item's path and an element/character offset
within it. That is a larger piece of work and would be a v2 of this format, with
step 1 above as the migration point.

## Known limitation

Resolution is at page granularity, not character granularity. Reopening a book
at 24pt after reading it at 12pt lands on the correct page of the correct
chapter, not the exact sentence. Fixing that needs a character offset from
structured text, which is not implemented.
