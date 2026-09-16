# Handoff — error, unsupported and DRM states

`DocumentErrorKind` is a real union parsed from the native message prefix by
`toDocumentError` in `src/sources/MuPDFSource.ts`:

```
'generic' | 'malformed' | 'passwordRequired' | 'wrongPassword'
| 'unsupported' | 'outOfMemory' | 'cancelled'
```

Four of these get their own screen. Two route elsewhere. One is not an error.

| Kind | Screen |
| --- | --- |
| `passwordRequired`, `wrongPassword` | `handoff/password.md` |
| `cancelled` | Not an error. Returns to the selector silently |
| `malformed` | §2.1 — damaged file |
| `unsupported` | §2.2 — format this build can't open |
| DRM (arrives as `malformed` or `unsupported`) | §2.3 — see the detection note |
| `outOfMemory` | §2.4 |
| `generic` | §2.5 |

---

## 1. Shared layout

### 1.1 Phone

```
┌──────────────────────────────┐
│ ‹  maintenance-log.pdf       │  filename stays visible, 56dp header
│                              │
│                              │
│              ⚠               │  40dp icon, alert.600, space.16 from top
│                              │
│      This file didn't open   │  type.display, centred, 2 lines max
│                              │
│   The PDF's page tree is     │  type.body, chrome.textMuted, 68ch,
│   damaged — it may have been │  centred
│   truncated during download. │
│                              │
│   ╭──────────────────────╮   │  PrimaryButton, 48dp, space.10 below body
│   │ Choose another       │   │
│   │ document             │   │
│   ╰──────────────────────╯   │
│                              │
│   object is not a stream     │  type.caption, chrome.textMuted,
│                              │  selectable, space.6 below
└──────────────────────────────┘
```

### 1.2 Surface Duo, spanned

The panel docks inside one leaf — right for LTR — while the other leaf keeps the
selector list live and unscrimmed. The reader can pick a different document
without dismissing the error. Icon, headline, body and buttons all sit within one
leaf's 540dp minus `space.12` and `fold.safeInset`, so nothing is bisected.

---

## 2. The five screens

### 2.1 `malformed` — damaged file

| | |
| --- | --- |
| Icon | Warning triangle, `alert.600` / `alert.200` |
| Headline | `This file didn't open` |
| Body | `The PDF's page tree is damaged — it may have been truncated during download.` For EPUB: `The EPUB's container is damaged — some of the file is missing.` |
| Primary | `Choose another document` |
| Secondary | none |
| Code | `DocumentError.message` — MuPDF's own text after the prefix |

**No retry.** The same bytes fail the same way. A retry button here trains the
reader to distrust every retry button in the app.

### 2.2 `unsupported` — format this build can't open

| | |
| --- | --- |
| Icon | Document-with-slash, `alert.600` / `alert.200` |
| Headline | `This kind of file isn't supported` |
| Body | `nitro-flipper opens PDF, EPUB and CBZ. This one is a .xps.` The extension is quoted from the path; the supported list comes from `supportedDocumentExtensions()` plus the archive formats, never hardcoded in the copy |
| Primary | `Choose another document` |
| Secondary | `Open in another app` — Android `ACTION_VIEW` intent, iOS share sheet. The one genuinely useful action on this screen, taken from Manus |
| Code | `DocumentError.message` |

### 2.3 DRM — protected file

**Detection.** `DocumentErrorKind` has no DRM member. A DRM-protected document
arrives as `malformed` or `unsupported` depending on where it fails, so the UI
detects it from the file rather than from the error kind:

- **EPUB:** the archive contains `META-INF/encryption.xml` or
  `META-INF/rights.xml` (Adobe ADEPT).
- **PDF:** the trailer has an `/Encrypt` dictionary whose `/Filter` is not
  `/Standard` — a non-standard security handler is DRM, while `/Standard` is the
  password case and belongs to `handoff/password.md`.

**This detection is not implemented and the checks above are untested.** Until it
is, a DRM file lands on `malformed` or `unsupported`, both of which are honest
about the symptom and wrong about the cause. This is the correct behaviour to
ship first; the DRM screen is what it upgrades to.

| | |
| --- | --- |
| Icon | Closed padlock, `chrome.textMuted` — **not** `alert.600`. A DRM file is not damaged and the app is not broken |
| Headline | `This book is protected` |
| Body | `nitro-flipper opens files that aren't copy-protected. Books bought from most stores are locked to that store's own app.` |
| Primary | `Choose another document` |
| Secondary | none |
| Code | none — nothing here is diagnosable |

The body names the situation without blaming the reader or the store. No
workaround is suggested, hinted at, or linked.

### 2.4 `outOfMemory` — ran out of room

| | |
| --- | --- |
| Icon | Warning triangle, `alert.600` |
| Headline | `Not enough memory to open this` |
| Body | `The document is large and the device is short on memory. Closing other apps may help.` |
| Primary | `Try again` — **the one case where retry can genuinely succeed**, because conditions change |
| Secondary | `Choose another document` |
| Code | `DocumentError.message` |

Per the notes in `docs/mupdf-integration-status.md`, `FZ_ERROR_MEMORY` does not
exist in 1.28.4 — allocation failure arrives as `FZ_ERROR_SYSTEM` or
`FZ_ERROR_LIMIT`, and the classifier maps those. So this screen can appear for
non-memory system failures too, which is why the body says "may help" rather
than promising.

### 2.5 `generic` — unknown

| | |
| --- | --- |
| Icon | Warning triangle, `alert.600` |
| Headline | `This file didn't open` |
| Body | `Something went wrong and we don't have a more specific reason.` The one place this copy is correct, because it is the one case where nothing more is known |
| Primary | `Try again` |
| Secondary | `Choose another document` |
| Code | `DocumentError.message` — the only signal anyone has here |

---

## 3. Inline errors — not every failure is a screen

A failure that does not prevent reading must not take the reader out of the book.

| Failure | Treatment |
| --- | --- |
| `onPageLoadError` on one page | Inline panel inside the letterbox: `Page 214 didn't render` + `Try again`. The rest of the document stays usable. **Today this routes to `setError` and replaces the whole reader** — see `critique.md` C-2 |
| `getOutline` rejects | Inline row inside the TOC panel |
| `search` rejects | Inline row inside the search panel |
| `relayout` rejects | Inline row in the appearance panel; the size value reverts |
| `persistentLocator` rejects | Toast: `Couldn't save that bookmark` + `Try again` |

---

## 4. Tokens

| Element | Token |
| --- | --- |
| Screen surface | `chrome.surface` |
| Icon | 40dp. `alert.600` `#B3261E` (6.10:1) / `alert.200` `#F2B8B5` (8.88:1). Padlock is `chrome.textMuted` |
| Headline | `type.display` 28/34, `chrome.text` |
| Body | `type.body`, `chrome.textMuted`, 68ch, centred |
| Primary | 48dp, `ribbon.600` fill / `#F6F7F9` label — 4.89:1. **Not** `alert.600` — the button is the way out, not the problem |
| Secondary | `TextButton` 48dp, `chrome.text` |
| Code | `type.caption`, `chrome.textMuted`, `selectable`, monospace |
| Inline panel | `chrome.raised`, `radius.md`, 1dp `chrome.border`, `elevation.flat` |

Body text is centred because it is one short paragraph under a centred headline.
Anything longer than three lines goes left-aligned — centred ragged text past
three lines is harder to read, and the 68ch measure is what keeps it under that.

---

## 5. Gesture conflicts

Static screens. The page-turn pan is not mounted — no document is open. On the
Duo the other leaf stays interactive so the reader can pick a different file
without dismissing the error.

---

## 6. Single vs spread

No pages. On a spanned Duo the panel takes one leaf and the selector keeps the
other; everywhere else it is a full screen.

---

## 7. Accessibility

- **Colour is never the carrier** (1.4.1): every state pairs `alert.600` with a
  distinct icon — warning triangle for `malformed` and `generic`, document-with-
  slash for `unsupported`, padlock for DRM — and a full sentence.
- **Announce on arrival**: `accessibilityLiveRegion="assertive"` on the container,
  and focus moves to the headline. The reader was waiting on an open and needs
  the outcome immediately (4.1.3).
- **Error identification and suggestion** (3.3.1, 3.3.3): each screen names what
  happened and what to do. `outOfMemory` names a concrete action the reader can
  take; `malformed` deliberately does not offer one, because there isn't one.
- **The code is selectable, focusable and reachable**, with the accessible name
  `Technical detail: object is not a stream.` Anyone filing a bug needs to copy
  it, and it is the only string distinguishing two different `malformed`
  failures.
- **Primary action names its destination.** `Choose another document`, not
  `OK`. `Try again` appears only where retrying can work.
- **Touch targets**: buttons 48dp full-width within the content column, `space.2`
  apart, never side by side — two 48dp buttons side by side on a 412dp phone at
  200% text scale truncate.
- **Focus order**: headline → body → primary → secondary → code. The code is last
  because it is the least useful thing on the screen to most readers and the most
  useful to one.
- **No keyboard trap** (2.1.2): system back and `Escape` return to the selector.
- **Reduced motion**: the screen appears with no transition. An error sliding in
  is the wrong register anyway.
