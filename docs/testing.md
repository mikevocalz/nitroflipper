# Test matrix

Which fixture proves which behaviour, at which gate, and what is still done by
hand. A row that says MANUAL is not a plan to automate it later; it is a
statement that today the only evidence is a person running it.

## The gates

| Gate | Command | Runs on | Cost |
| --- | --- | --- | --- |
| Unit (TS) | `npm run test:ts` | node, no device | seconds; 22 tests in 9 suites |
| Native (C++) | `npm run test:cpp` | host, no MuPDF | seconds |
| Native (C++, MuPDF) | `npm run test:mupdf` | host, needs the MuPDF tree | minutes on a cold build, seconds after |
| Integration (app) | `example/__tests__` via jest | node, no device | seconds; one render smoke test |
| Device | by hand, see below | iOS/Android hardware or simulator | minutes |

`npm test` runs typecheck plus the first two. It deliberately leaves out
`test:mupdf`: MuPDF is a 66MB download and a multi-minute first build, and the
solver and archive tests have to stay fast enough to run on every save. Point
`-DMUPDF_SOURCE_DIR=` at an extracted tree to skip the download.

## Fixtures

All of them are generated. Nothing here is downloaded, scanned, or lifted from
a published book, so none of it carries anyone's copyright.

| Fixture | Generator | Bytes | What it is |
| --- | --- | --- | --- |
| `comic.pdf` | `generate_comic.py` | 718033 | 6 raster pages, uniform size, one wide spread |
| `comic.epub` | `generate_comic.py` | 78642 | Fixed-layout EPUB 3, one image per spine item |
| `ltr.cbz` / `rtl.cbz` | `generate_comic.py` | 75273 / 75045 | CBZ with `ComicInfo.xml`, one marked LTR and one RTL |
| `pages/*.jpg` | `generate_comic.py` | 81-162K each | The raster pages on their own, for the scaler |
| `pages/unsupported.webp` | hand-placed | 234452 | A format the scaler must refuse rather than guess at |
| `reflow.epub` | `generate_edge_cases.py` | 25110 | Reflowable EPUB 3, 6 spine items, 4966 generated words |
| `rtl.epub` | `generate_edge_cases.py` | 9394 | Reflowable, `page-progression-direction="rtl"`, Arabic + Hebrew |
| `mixed.pdf` | `generate_edge_cases.py` | 3648 | 4 pages at 3 sizes: A4 portrait, A5 landscape, double-width, A4 |
| `locked.pdf` | `generate_edge_cases.py` | ~3.7K | RC4-128, user password `open-sesame` |
| `malformed.pdf` | `generate_edge_cases.py` | 573 | Truncated before its first indirect object |

Regenerate with `python3 fixtures/generate_comic.py` and
`python3 fixtures/generate_edge_cases.py`. Both need `pillow` and `reportlab`.
Every byte comes from a fixed seed, so a regeneration is reproducible except
for the timestamps and the encryption document ID reportlab writes into the
PDFs; `locked.pdf` moves by a few dozen bytes between runs for that reason.

### Why `comic.epub` is not enough

`comic.epub` is pre-paginated: one image per spine item, sized by a viewport
meta tag. `fz_is_document_reflowable` still returns true for it, because MuPDF
sets that flag for every EPUB, so the repagination tests written against it
take the reflowable path and then assert `atLargeType >= atSmallType`. Measured:
comic.epub reports 6 pages at 12pt, 20pt, 24pt and 48pt in a 300x500pt box, so
that assertion is 6 >= 6 at every size and would still hold if `layout()` did
nothing at all.

`reflow.epub` is what makes it bite: 4966 words of flowing text across 6 spine
items. In a 300x500pt box it is 44 pages at 12pt and 323 at 24pt; widen the
column to 600pt at 12pt and it falls to 22.

## Fixture class to gate

AUTO means a named test fails if the behaviour regresses. MANUAL means a person
has to look. NONE means nothing covers it today.

No TypeScript test and no example-app test loads a fixture. `roundtrip.test.ts`
drives `FixedPaginator` and `ReflowablePaginator` with in-memory paragraph
arrays, and `example/__tests__/App.test.tsx` only asserts that `<App/>` renders.
Both columns below are honest about that: every fixture's only automated
evidence is the C++ gate.

| Fixture class | Unit (TS) | Native C++ | Integration | Device |
| --- | --- | --- | --- | --- |
| Fixed-layout PDF (`comic.pdf`) | NONE | AUTO, 18 cases | NONE | MANUAL, curl over a real page |
| Mixed-size PDF (`mixed.pdf`) | NONE | AUTO, per-page box and aspect | NONE | MANUAL, spread pairing across a size change |
| Encrypted PDF (`locked.pdf`) | NONE | AUTO, 2 cases | NONE | MANUAL, password prompt UI |
| Corrupt PDF (`malformed.pdf`) | NONE | AUTO, kind + recovery | NONE | MANUAL, error surface |
| Fixed-layout EPUB (`comic.epub`) | NONE | AUTO, but see below | NONE | MANUAL |
| Reflowable EPUB (`reflow.epub`) | NONE | AUTO, 4 cases | NONE | MANUAL, font-size change keeps the reading position |
| RTL EPUB (`rtl.epub`) | NONE | AUTO, opens/lays out/renders only | NONE | MANUAL |
| CBZ, LTR and RTL (`*.cbz`) | NONE | AUTO, `ComicArchive.test.cpp` | NONE | MANUAL, reading direction on screen |
| Raster pages (`pages/*.jpg`) | NONE | AUTO, `ImageScaler.test.cpp` vs `golden.json` | NONE | NONE |
| Unsupported image (`unsupported.webp`) | NONE | AUTO, refused by `scaleEncodedImage` | NONE | NONE |

The pagination model itself is covered without fixtures: `roundtrip.test.ts`
exercises locator round-trips across single and spread modes, `PagePairing` and
`SpreadPolicy`, and `PageTextureCache.test.ts` covers cache identity, LRU
eviction and retain/release. 22 tests, 9 suites, all passing.

### What the reflowable EPUB cases assert

| Case | Assertion |
| --- | --- |
| `bigger type in the same box means strictly more pages` | `pageCount(24pt) > pageCount(12pt)`, strict, so a no-op `layout()` fails |
| `a mid-book locator still lands in the same chapter` | Locator and `fz_bookmark` both resolve to the chapter they came from, and that chapter's heading text is unchanged |
| `layout width is one column, not the spread` | 600pt gives fewer pages than 300pt (22 vs 44). Guards the bug where a caller passes the spread width as the column width and every stored locator lands in the wrong place |
| `repeated open/layout/render/close stays correct` | 5 cycles give an identical page count, and the final render has varying pixels rather than a blank field |

### What `rtl.epub` deliberately does not assert

Reading direction. The fixture's spine carries
`page-progression-direction="rtl"`, and neither this engine nor MuPDF 1.28.4
reads that attribute — the string appears nowhere in MuPDF's `source/` tree,
and `Location`, `Snapshot` and `PageBox` have no field to hold it. RTL page
ordering today comes from the CBZ `ComicInfo.xml` path, not from EPUB metadata.
The test says so in a comment, and the assertion goes in that spot when EPUB
direction support lands.

## Failure sequences

| Sequence | Gate | Status | Evidence |
| --- | --- | --- | --- |
| Open a file that is not a document | Native | AUTO | `a malformed file reports Malformed, not a crash` |
| Open a truncated PDF, then open a good one | Native | AUTO | `malformed.pdf: rejected cleanly, and the engine survives it` |
| Open a missing path, then open a good one | Native | AUTO | `a missing file reports an error and leaves the engine usable` |
| Encrypted open with no password, wrong password, right password | Native | AUTO | `locked.pdf: open without a password reports PasswordRequired` |
| Wrong password supplied at open time | Native | AUTO | `locked.pdf: the password can also be supplied at open time` |
| Accessors after `close()` | Native | AUTO | `accessors on a closed document throw rather than crash` |
| `close()` called repeatedly | Native | AUTO | `close is idempotent` |
| Reopen the same instance 5 times | Native | AUTO | `reopening the same instance repeatedly does not leak state` |
| Reopen a reflowable document 5 times and relayout each time | Native | AUTO | `reflow.epub: repeated open/layout/render/close stays correct` |
| Render issued before a relayout arrives after it | Native | AUTO | `a render carries the generations it was produced under` |
| Search abandoned mid-scan | Native | AUTO | `search honours its cancellation token` |
| Shutdown with 8 renders queued | Native | AUTO | `close during queued work cancels it rather than racing the document` |
| Work submitted after shutdown | Native | AUTO | `work submitted after shutdown settles instead of hanging` |
| Executor released while a job is in flight | Native | **FAILING** | See "Open defects" |
| Two documents open at once, one closed | Native | AUTO | `two documents are independent` |
| Out-of-memory during a render | — | NONE | No fixture forces an allocation failure |
| Document deleted from disk while open | — | NONE | |
| App backgrounded mid-render | Device | MANUAL | |
| Low-memory warning with textures resident | Device | MANUAL | |

## Device gates

None of these are automated. Each needs a person with hardware.

| Check | Platform | How |
| --- | --- | --- |
| Curl animation holds 60fps under a drag | iOS, Android | `example/`, drag a page, watch the frame graph |
| Texture budget holds under fast page turns | iOS, Android | `example/`, flip 50 pages, watch memory |
| Font-size change keeps the reading position | iOS, Android | `example/` with `reflow.epub`, change size mid-chapter |
| Password prompt appears and unlocks | iOS, Android | `example/` with `locked.pdf` |
| Corrupt file shows an error, not a blank reader | iOS, Android | `example/` with `malformed.pdf` |
| RTL comic reads right to left | iOS, Android | `example/` with `rtl.cbz` |
| 16 KB page-size compliance | Android | `readelf -l` on the shipped `.so`, see `mupdf-integration-status.md` |

## Open defects

### `DocumentExecutor` can join its own worker thread

`npm run test:mupdf` aborts with SIGABRT. The message is
`thread::join failed: Resource deadlock avoided`, and the stack is:

```
DocumentExecutor::run()                          <- worker thread
  ~__func<...DocumentExecutor::submit<int>...>   <- worker destroys the finished job
    __on_zero_shared()                           <- the job held the last shared_ptr
      ~DocumentExecutor()
        DocumentExecutor::shutdown()
          worker_.join()                         <- joining itself
            std::system_error escapes a noexcept function -> std::terminate
```

`submit()` captures `self` into the job. The worker pops the job, runs it, and
then destroys it at the end of the loop iteration. If the caller has already
dropped its own `shared_ptr` — which is exactly what the existing test
`executor destruction joins its worker` sets up — that destruction is the last
reference release, so `~DocumentExecutor` runs on the worker thread and
`shutdown()` joins the thread it is running on.

The bug predates the edge-case fixtures. A 20-line program containing only the
body of that existing test plus a 300ms sleep reproduces it against
`comic.pdf`, with no Catch2 and no new fixture. Running that test alone passes
only because the process exits before the worker is scheduled to drop the job;
adding any test case after it makes the abort deterministic.

Counts as of the last run:

| Selection | Result |
| --- | --- |
| The 23 pre-existing cases alone | 23 passed, 77 assertions, then SIGABRT during teardown |
| The 9 new cases alone | 9 passed, 110 assertions |
| Everything except `executor destruction joins its worker` | 31 passed, 186 assertions |
| Everything | aborts at case 24; 23 passed, 77 assertions before the abort |

The fix belongs in `cpp/mupdf/DocumentExecutor.cpp`: detect that the destructor
is running on the worker and `detach()` instead of joining, or keep the last
reference off the worker by clearing the job slot before the loop iterates.

### A corrupt PDF can open with zero pages

Not currently a fixture, found while choosing where to truncate
`malformed.pdf`. Truncating `mixed.pdf` mid-object and appending a dangling
`7 0 obj << /Type /Page` makes `open()` succeed and `pageCount()` return 0.
A reader would show an empty document instead of an error. Truncating at 1800
of 3648 bytes is worse in a different way: MuPDF's repair pass rebuilds the
page tree and hands back a readable 4-page document, so half a file is not a
malformed file.

`malformed.pdf` is therefore cut before the first indirect object, which leaves
repair nothing to work with and produces `FZ_ERROR_FORMAT` / "no objects
found" / `ErrorKind::Malformed`. Whether `open()` should refuse a zero-page
document outright is an open question, and nothing tests it either way today.
