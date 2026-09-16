# Mobbin references — error, unsupported and DRM states

Task: explain why a document did not open, and give the reader a next move.

`DocumentErrorKind` is a real union — `generic`, `malformed`, `passwordRequired`,
`wrongPassword`, `unsupported`, `outOfMemory`, `cancelled` — parsed out of the
native message prefix by `toDocumentError`. The UI branches on it. Three of these
kinds need genuinely different screens, and a single "Something went wrong" would
throw away information the engine went to some trouble to produce.

DRM is the case the union does not name. An encrypted-with-DRM PDF or an Adobe
ADEPT EPUB arrives as `malformed` or `unsupported` depending on where it fails.
MuPDF cannot open either, and no password will help.

## References

1. **Manus, unsupported format** —
   [mobbin.com/screens/e9bf92a4-1163-4d60-bcaf-f7d84e9797fb](https://mobbin.com/screens/e9bf92a4-1163-4d60-bcaf-f7d84e9797fb)
   The filename stays in the header (`city_sips_posters.zip`), a document glyph
   with a `?`, the sentence `Preview is not supported for current file format.`,
   and one action that is genuinely useful: `Open in other apps`.
2. **PayPal** —
   [mobbin.com/screens/305815a1-eb96-4544-bde7-c1342b7e15ce](https://mobbin.com/screens/305815a1-eb96-4544-bde7-c1342b7e15ce)
   Warning triangle, headline, one supporting line, `Try Again` as the primary
   and `Not Now` as a text escape below it.
3. **Freenow** —
   [mobbin.com/screens/d156add0-4181-489a-8fb7-3afa0b008e96](https://mobbin.com/screens/d156add0-4181-489a-8fb7-3afa0b008e96)
   `Something went wrong` as the headline with the actual cause as the second
   line: `Freenow Plus is currently not available in your city.`
4. **Yuka, product not supported** —
   [mobbin.com/screens/0c4ebb0c-713d-4f59-9cb8-771360420495](https://mobbin.com/screens/0c4ebb0c-713d-4f59-9cb8-771360420495)
   Titled `Product not supported` in the header, with body copy that states the
   boundary: `Yuka only rates food or cosmetics products.`
5. **eBay, restriction notice** —
   [mobbin.com/screens/84b502c6-b7a6-470f-aecf-067b5d0ac854](https://mobbin.com/screens/84b502c6-b7a6-470f-aecf-067b5d0ac854)
   A red banner, plain-language explanation of the restriction, a concrete
   alternative, and a small monospaced reference code at the bottom.

## Adopted

**Keep the filename on screen (Manus).** Every one of these states is reached
from a list of similar documents. The filename is the first thing the reader
checks and the cheapest thing to show. It stays in the header on all three error
variants.

**Name the boundary, not the failure (Yuka).** `Product not supported` plus
`Yuka only rates food or cosmetics` tells the reader the rule. The DRM screen
does the same: `This book is protected by DRM` plus `nitro-flipper opens PDF,
EPUB and CBZ files that aren't copy-protected. This one is.`

**Cause on the second line (Freenow).** Headline names the category, second line
names this instance. `This file didn't open` / `The PDF's page tree is damaged —
it may have been truncated during download.`

**A monospaced reference code, small and last (eBay).** `DocumentError.message`
carries MuPDF's own text after the `mupdf/<kind>:` prefix. It is the only string
that distinguishes two different `malformed` failures and it is what anyone
filing a bug needs. It sits at the bottom in `type.caption`, selectable, at
`chrome.textMuted` — present without competing with the sentence above it.

**A real alternative action, not just retry (Manus's `Open in other apps`).**
Retry is the right primary only when retrying could work. For `malformed`,
`unsupported` and DRM it cannot — the same bytes will fail the same way. Those
screens' primary is `Choose another document` and there is no retry at all.

## Rejected

**Character illustrations (Plenty of Fish's skeleton fish, Eventbrite's UFO,
Noom).** Rejected: they cost an asset, say nothing about the cause, and a jokey
drawing over a reader's failed 400-page manual reads as flippant. An icon from
the same family as the rest of the UI, at 40dp, in `alert.600`.

**`Something went wrong` as a bare headline (Eventbrite, PayPal, Binance).**
Rejected when the kind is known, which is four cases out of seven. It is kept
only for `generic`, which is precisely the case where nothing more is known.

**`Try Again` on every error (PayPal, Noom, Plenty of Fish, Eventbrite, Freenow —
five of five).** Rejected as a default. Offering a retry that provably cannot
succeed trains the reader to distrust the button. Retry appears only for
`outOfMemory` (closing the previous document may free enough) and `generic`.

**Red as the carrier of meaning (eBay's banner, Binance).** Rejected as the sole
cue per WCAG 1.4.1: every alert state pairs `alert.600` with an icon and a
sentence, and the icon differs by kind — a warning triangle for `malformed`, a
document-with-slash for `unsupported`, a closed padlock for DRM.

**A dead end with only a dismiss (IKEA, TikTok).** Rejected: `✕` returns the
reader to the list they just came from with no more information than before.
Every error screen has one primary that moves them forward and one escape that
goes back, and the escape says where it goes.
