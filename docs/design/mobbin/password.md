# Mobbin references — password prompt

Task: unlock an encrypted document. Backed by `MuPDFSource.authenticate(password)`,
which returns a boolean, and by `DocumentError.needsPassword`, true for kind
`passwordRequired` or `wrongPassword`.

This is a **document** password, not an account password. The distinction drives
every adopt/reject below: there is no account to recover, no reset email, no
rate limit, and no server. A wrong password is a local mismatch and the reader
can try again immediately.

`docs/mupdf-integration-status.md` lists password handling as written but
untested — there is no protected fixture. This screen is specified; it is not
verified.

## References

1. **Craft, document password** —
   [mobbin.com/screens/07d5845d-c3f6-4270-950a-d0bcc2c7c7ee](https://mobbin.com/screens/07d5845d-c3f6-4270-950a-d0bcc2c7c7ee)
   A small dialog over the still-visible document, with a sentence explaining
   what the password controls before the field: `When a password is set, only
   people with the password can access the contents of this link.` `Cancel` and
   `Save` side by side, `Save` disabled until the field has content.
2. **OKX** —
   [mobbin.com/screens/218c83ee-23f9-4b2b-8862-4f2155039a8c](https://mobbin.com/screens/218c83ee-23f9-4b2b-8862-4f2155039a8c)
   A sheet with `Password` as a persistent heading above the field, an eye-slash
   reveal toggle inside the field, and one full-width `Confirm` button.
3. **Wise** —
   [mobbin.com/screens/3a908149-bd71-427d-873e-c22973c22545](https://mobbin.com/screens/3a908149-bd71-427d-873e-c22973c22545)
   `Enter your password to show your card PIN` as the headline — the headline
   states what unlocking achieves. A persistent `Your password` label above the
   field. The primary action is disabled until the field is non-empty.
4. **Lloyds Mobile Banking** —
   [mobbin.com/screens/e75d6e0c-83dc-46b0-9e95-b461bbd91929](https://mobbin.com/screens/e75d6e0c-83dc-46b0-9e95-b461bbd91929)
   A platform alert with a `Show` text toggle inside the field and `Cancel` / `OK`.
5. **Binance** —
   [mobbin.com/screens/1b39ca4c-239b-4ff6-a99f-ddbddabc57cb](https://mobbin.com/screens/1b39ca4c-239b-4ff6-a99f-ddbddabc57cb)
   Masked field with a clear (`✕`) and a reveal (`👁`) control side by side, and
   the identity being unlocked shown above the field.

## Adopted

**A headline that names what unlocking gets you (Wise).** `Enter your password to
show your card PIN` beats `Password`. Here: `This document is locked` with the
filename directly beneath it, so a reader who picked the wrong file from a list
of six similarly named PDFs can tell before typing.

**A persistent label above the field (OKX, Wise).** Not a placeholder. A masked
field whose only label is placeholder text loses that label the moment the first
character is typed, which fails WCAG 3.3.2 and is the most common form failure in
this pattern.

**Reveal toggle inside the field (OKX, Lloyds, Binance).** Document passwords are
long, are copied off a sticky note, and are frequently mistyped. The toggle is a
48 × 48dp target with `accessibilityState={{ checked }}`, and its accessible name
changes between `Show password` and `Hide password` rather than staying `Toggle`.

**Primary action disabled until the field is non-empty (Wise, Craft).** MuPDF
rejects an empty password as `wrongPassword`, which would put the reader into a
failure state they did not cause. Preventing the submit is cheaper than
explaining it (H5).

**The document stays visible behind the dialog (Craft).** On a spanned Duo the
dialog docks to one leaf and the other leaf keeps the selector list, so the
reader can see which file they are unlocking.

## Rejected

**`Forgot password?` (OKX, Wise, Lloyds, Binance — four of five).** Rejected:
there is nothing to recover. The password belongs to whoever encrypted the PDF.
A dead link here is worse than no link, because it implies a recovery path
exists.

**Password composition rules (Artsy's `must be at least 8 characters…`).**
Rejected: this field is not creating a password, it is matching one. Any rule
shown is either wrong or irrelevant.

**Platform alert dialog (Lloyds).** Rejected: a system alert cannot show the
filename, cannot carry the error state inline, and on a spanned Duo lands
centred over the hinge. A `LeafSheet` handles all three.

**`Cancel` / `OK` as the button pair (Lloyds).** Rejected under the copy rule in
`tokens.md` §7: an action keeps its name through the flow. The buttons are
`Unlock` and `Choose another document`, which say what happens.

**Attempt counting or lockout (implied by the banking references).** Rejected:
there is no server, no account, and no threat model that a local retry limit
addresses. The reader gets unlimited attempts, with the error copy varying after
the third so it stops repeating itself — see `handoff/password.md`.
