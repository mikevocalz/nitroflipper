# Mobbin references — search and results

Task: find a phrase and get to it. Backed by `MuPDFSource.search(needle, maxHits = 200)`,
which is cancellable and returns `SearchResult[]` carrying `pageNumber`,
`chapter`, `page` and a quad (`x0, y0, x1, y1`) in page coordinates.

The engine returns **coordinates, not text**. There is no snippet in the result.
Building one means a second call to `getPageText(index)` and slicing around the
quad. Every reference below shows a snippet; the handoff spec says how this one
earns its snippet and what it shows until the text arrives.

## References

1. **Apple Books, Search Book** —
   [mobbin.com/screens/df9458bb-93ae-4866-b225-8d4a0f9e23d4](https://mobbin.com/screens/df9458bb-93ae-4866-b225-8d4a0f9e23d4)
   Results as a list: chapter label, right-aligned page number, two lines of
   surrounding sentence with the term in bold. The search field sits at the
   bottom, above the keyboard, with a clear button and a close button.
2. **Matter, in-page find** —
   [mobbin.com/screens/1e9f8555-8720-428f-91d1-cc5f335b801f](https://mobbin.com/screens/1e9f8555-8720-428f-91d1-cc5f335b801f)
   No result list. A find bar over the keyboard shows `1/9` with up and down
   chevrons and a `Done` button; the current match is highlighted in place on the
   page behind it.
3. **Brink, Search Transcript** —
   [mobbin.com/screens/85897856-0025-41a1-8ed1-87c5b8e8e6dc](https://mobbin.com/screens/85897856-0025-41a1-8ed1-87c5b8e8e6dc)
   A hybrid: `2 of 107` with step chevrons at the top, the content behind dimmed
   except for the matches, which stay at full contrast.
4. **Freeform, PDF find bar** —
   [mobbin.com/screens/bdeb5d33-55ff-4580-8994-c83e47f4b89b](https://mobbin.com/screens/bdeb5d33-55ff-4580-8994-c83e47f4b89b)
   A compact bar: query, `1 of 2`, up/down chevrons, and the match highlighted in
   yellow on the rendered PDF page above.
5. **Otter.AI transcript search** —
   [mobbin.com/screens/0a13bb45-3a25-4bc1-a283-67a2d9756370](https://mobbin.com/screens/0a13bb45-3a25-4bc1-a283-67a2d9756370)
   `1 result` stated in plain text above the list, with each hit highlighted in
   its own line of context.

## Adopted

**Both modes, switched by device (Apple Books' list and Freeform's step bar).**
Tom's task on a spanned Duo wants the list on one leaf and the page on the other
— he is comparing hits. On a phone a result list covers the page entirely, and
stepping through matches with chevrons keeps him in the document. The spec ships
the list panel when spanned and the step bar on a phone, with the same underlying
result set.

**The result count stated in words (Otter's `1 result`).** `2 of 107` tells you
where you are; `107 results` tells you whether the query was any good. Both are
shown, because `maxHits` is capped at 200 and a reader who hits the cap must be
told the list is truncated rather than left to assume they saw everything.

**Highlight the term in the snippet with fill *and* a rule (Apple Books uses
bold, Freeform uses yellow).** Bold alone is invisible in a monospaced or
already-bold run; yellow alone fails 1.4.1. The spec uses `hit.fill` plus a 2dp
`hit.rule` underline, which survives both.

**A cancel affordance on the field (Apple Books' `✕`).** `search` takes a
cancellation token and the engine tests exercise it. Search over a 600-page
document is the one operation in this app long enough to need interrupting, and
the token exists specifically so the UI can.

## Rejected

**Dimming the page to make matches pop (Brink).** Rejected: it drops every
non-matching word below 4.5:1, which turns a legibility feature into a contrast
failure for the 99% of the page that is context. The match gets marked up; the
page stays at full contrast.

**Search-as-you-type.** Rejected: each keystroke would queue a full-document
search on the executor's single worker thread, and `DocumentExecutor` serialises
every operation — a render behind three abandoned searches waits for all of them.
The field commits on submit. A debounce would still queue work that the reader
never asked for.

**A snippet built by guessing (all five references show one).** Not rejected,
but gated: the snippet requires `getPageText` per hit page, which is an async
call per result. The list renders chapter and page immediately and fills snippets
in as they resolve, with a one-line `type.body` skeleton in the interim. It never
renders an empty quoted string.

**Treating zero results as a neutral outcome (all five references).** Rejected
outright, and this is the most important decision on this screen. A scanned PDF
with no text layer returns zero hits for every query, and the engine cannot OCR
it. "No results" would tell Tom the phrase is absent when it is on the page in
front of him. The zero state distinguishes *searched and found nothing* from
*this document has no searchable text*, using `getPageText` on the current page
as the test. Exact copy is in `handoff/search.md`.
