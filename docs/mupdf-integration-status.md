# MuPDF integration: status

Last updated 2026-09-16. Branch `master`, starting commit `aac2d70`.

This file exists so nobody has to guess which parts of the integration are real.
Capabilities are in one of three states, and nothing is described as working
because it compiles.

## Implemented and tested

Verified by `npm run test:mupdf` — 23 cases, 77 assertions, against the real
`fixtures/output/comic.pdf` and `comic.epub`.

| Capability | Evidence |
| --- | --- |
| MuPDF 1.28.4 builds from pinned, checksummed source | host, Android arm64, iOS device, iOS simulator |
| PDF open, page count, page geometry | `PDF opens and reports real geometry` |
| PDF render to a box, aspect preserved, PNG output | `PDF renders to the requested box preserving aspect` |
| Raw RGBA render with explicit stride and alpha state | `raw render reports its own stride and format` |
| EPUB layout through MuPDF's own engine | `EPUB lays out through MuPDF and repaginates` |
| Per-document CSS via `fz_style_document` | `two documents are independent` |
| Document and layout generations stamped on results | `a render carries the generations it was produced under` |
| Relayout anchor preservation via `fz_make_bookmark` | `a locator survives a relayout at a different font size` |
| Versioned locator, with version and garbage rejected | `an unparsable locator is rejected, not guessed at` |
| Malformed and missing files reported, engine still usable | two cases |
| Repeated open/close, idempotent close | two cases |
| Two independent documents | `two documents are independent` |
| Outline extraction (iterative, depth-bounded) | exercised via the Android link probe |
| Search with cancellation | `search honours its cancellation token` |
| Executor: promises always settle, teardown with work in flight | four cases |

Measured, on this machine:

- Android arm64 shared library, `--gc-sections`, stripped: **15.1 MB per ABI**
- All four `LOAD` segments aligned `0x4000` — **16 KB page-size compatible**
- Engine cross-compile: 41.7 s (Android), 44.6 s (iOS device), 45.1 s (iOS sim)
- Embedded fonts default `no-cjk`: 179 files, drops 147 MB of CJK source

## Implemented, not yet proven

- **Outline, page text, search** compile and run without error, but the
  fixtures are generated comic pages. They need a real text-bearing PDF and a
  long-form EPUB before any claim about quality.
- **Password handling.** The `PasswordRequired` / `WrongPassword` paths are
  written and the classifier is mapped against the real 1.28.4 error enum.
  There is no password-protected fixture yet, so they are untested.

## Not started

Everything from here is unbuilt. No part of this is wired to the app.

- **Nitro layer.** No `MuPDFSource.nitro.ts`, no `HybridMuPDFSource`, no
  Nitrogen codegen run. The engine has no route to JS yet.
- **`MuPDFSource` TypeScript adapter** implementing `PageSource`.
- **Renderer cache rewrite.** `src/renderer/PageCurlView.tsx` still keys its
  cache by page index alone, still omits the viewport from the loader effect's
  dependencies, and still calls `dispose()` from the loader while a frame may be
  sampling the texture. ADR-0003 specifies the fix; none of it is written.
- **Curl integration** with real documents, spread mapping, RTL.
- **iOS podspec** and Android Gradle wiring. The CMake builds for both
  platforms; nothing consumes it from the app build yet. `react-native.config.js`
  still has `ios: null`.
- **Example reader.** No document selector, TOC, search UI, bookmarks, text-size
  controls, or password prompt.
- **Design artifacts.** None of `docs/design/` exists — no research brief, no
  Mobbin reference sets, no tokens, no copy, no handoff specs, no accessibility
  audit, no critique.
- **CI.** No workflow for typecheck, native tests, Android or iOS builds, or a
  packed-package smoke test.
- **`npm pack` verification** and clean-consumer installs.
- **Device performance measurement.** No first-page latency, frame times, or
  memory figures on named hardware. Nothing has run on a device.
- **Reflowable EPUB fixture.** `comic.epub` is fixed-layout, so the repagination
  tests currently take their fixed-layout branch. The character-count estimator
  in `src/pagination/ReflowablePaginator.ts` is still in place and still used by
  the app; it has not been removed, because nothing has replaced it yet.

## Known upstream notes

- MuPDF warns `unknown epub version: 3.0` on our EPUB fixture. Harmless, but it
  means the fixture's version string is not in the form `epub-doc.c` expects.
- The context-global `fz_set_user_css` / `fz_set_use_document_css` are marked
  deprecated in MuPDF's `CHANGES` for 1.28.0, but carry no deprecation attribute
  in the headers, so using them compiles without warning. `fz_style_document` is
  what this engine uses.
