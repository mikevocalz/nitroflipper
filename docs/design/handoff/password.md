# Handoff — password prompt

Backed by `MuPDFFactory.openDocument(path, password)` and
`MuPDFSource.authenticate(password): Promise<boolean>`, with
`DocumentError.needsPassword` true for kinds `passwordRequired` and
`wrongPassword`.

**Status: specified, not verified.** `docs/mupdf-integration-status.md` records
password handling as written with the classifier mapped against the real 1.28.4
error enum, but there is no password-protected fixture and no test. Nothing in
this file has been exercised.

A document password is not an account password. There is no server, no account,
no recovery, and no rate limit — the password belongs to whoever encrypted the
file. Every decision below follows from that.

---

## 1. Layout

### 1.1 Phone — centred dialog, not a full screen

```
┌──────────────────────────────┐
│ ▓▓ selector list, dimmed ▓▓  │  scrim.sheet
│   ╭──────────────────────╮   │
│   │ 🔒                   │   │  32dp padlock, chrome.textMuted
│   │ This document is     │   │  type.title
│   │ locked               │   │
│   │ maintenance-log.pdf  │   │  type.caption, chrome.textMuted
│   │                      │   │
│   │ Password             │   │  persistent label, type.label
│   │ ┌──────────────────┐ │   │
│   │ │ ••••••••      👁 │ │   │  48dp field, reveal inside
│   │ └──────────────────┘ │   │
│   │                      │   │
│   │ ╭──────────────────╮ │   │
│   │ │      Unlock      │ │   │  PrimaryButton, 48dp
│   │ ╰──────────────────╯ │   │
│   │  Choose another      │   │  TextButton, 48dp
│   │  document            │   │
│   ╰──────────────────────╯   │
└──────────────────────────────┘
```

Dialog 320dp wide (or screen width minus `space.8`, whichever is smaller),
`radius.md`, `chrome.raised`, `elevation.raised`, `space.6` internal padding.

### 1.2 Surface Duo, spanned

The dialog docks **entirely inside one leaf** — the right leaf for LTR, centred
vertically, `space.12` from the outer edge and `fold.safeInset` from the hinge.
The other leaf keeps the selector list visible and unscrimmed, so the reader can
confirm which file they are unlocking.

A dialog centred on a 1080dp-wide spanned display would be bisected by the hinge.
This is the clearest case of the rule that chrome never crosses the fold.

---

## 2. Tokens

| Element | Token |
| --- | --- |
| Dialog surface | `chrome.raised`, `radius.md`, `elevation.raised` |
| Scrim | `scrim.sheet` `rgba(15,17,20,0.48)` |
| Padlock | 32dp, `chrome.textMuted` — 7.44:1 light, 8.48:1 dark |
| Headline | `type.title`, `chrome.text` |
| Filename | `type.caption`, `chrome.textMuted`, middle-ellipsis |
| Field label | `type.label`, `chrome.text`, `space.2` above the field |
| Field | 48dp, `radius.sm`, 1dp `chrome.border` — **3.56:1** light, **3.18:1** dark (WCAG 1.4.11) |
| Field focused | 2dp `ribbon.700` / `ribbon.300` ring, plus the border stays |
| Field error | 2dp `alert.600` / `alert.200` ring **plus** the message below **plus** a warning glyph |
| Reveal toggle | 48 × 48dp inside the field's trailing edge, `chrome.textMuted` glyph |
| Error message | `type.caption`, `alert.600` — 6.10:1 light / `alert.200` — 8.88:1 dark |
| Primary | 48dp, `ribbon.600` fill, `#F6F7F9` label — **4.89:1** |
| Primary disabled | `chrome.divider` fill, `chrome.textDisabled` label, `accessibilityState.disabled` |
| Secondary | `TextButton` 48dp, `chrome.text` |

---

## 3. States

| State | Copy and behaviour |
| --- | --- |
| `prompt` | As drawn. Field empty, autofocused, keyboard up, `Unlock` disabled |
| `ready` | Field non-empty → `Unlock` enabled. MuPDF treats an empty password as `wrongPassword`, so preventing the submit prevents an error the reader did not cause (H5) |
| `authenticating` | `Unlock` shows a 16dp indicator and its label becomes `Unlocking…`; the field goes read-only but stays visible so the reader can see what they typed |
| `wrongPassword`, attempts 1–2 | Field keeps its text and selects it all. Error below the field: `That password didn't work. Check for capital letters and spaces.` The two most common causes, stated concretely |
| `wrongPassword`, attempt 3+ | Error changes rather than repeating: `Still locked. Document passwords are set by whoever made the file — there's no way to reset it from here.` This is the truth and it stops the reader trying variations forever |
| `unlocked` | Dialog dismisses. The document opens. The selector row keeps a padlock glyph so the reader knows next time |
| `openFailedAfterUnlock` | Correct password, document still fails — DRM or corruption behind the encryption. Routes to `handoff/error.md` with the real kind. Never a password error, because the password was right |
| `cancelled` | `Choose another document` returns to the selector with no state change |

Copy that is deliberately absent: `Forgot password?`, any composition rule, any
attempt counter, any lockout.

---

## 4. Gesture conflicts

Modal. The scrim consumes touches on the phone; the page-turn pan does not exist
here because no document is open. On the Duo the other leaf stays interactive so
the reader can scroll the selector list while the dialog is up — the dialog is
modal within its leaf, not across the device.

---

## 5. Single vs spread

Not a page-rendering screen. On a spanned Duo it is a one-leaf dialog with a live
selector on the other leaf; everywhere else it is a centred dialog.

---

## 6. Accessibility

- **Persistent visible label** `Password` above the field (3.3.2). Never a
  placeholder-as-label — the label would vanish on the first keystroke, which is
  exactly when a masked field needs it most.
- **Field semantics**: `secureTextEntry`, `textContentType="password"`,
  `autoComplete="password"`, `autoCorrect={false}`, `autoCapitalize="none"`.
  Autocapitalising the first character of a case-sensitive password is an error
  the app would be creating (H5).
- **Reveal toggle** is 48 × 48dp with a name that changes with state —
  `Show password` / `Hide password` — and `accessibilityState={{ checked }}`.
  A single name for two states is the standard failure here (4.1.2).
- **Errors are text, not colour** (1.4.1, 3.3.1): the red ring is accompanied by
  a warning glyph and a full sentence, and the message is in the field's
  `accessibilityLabel` so it is read when focus returns to the field.
- **Error suggestion** (3.3.3): the attempts-1-to-2 copy names two concrete
  causes. Generic "invalid password" copy fails this criterion.
- **Announce the error** with `accessibilityLiveRegion="assertive"` on the
  message. Assertive rather than polite: the reader is waiting on this one
  result and nothing else is happening.
- **Focus** starts on the field, returns to the originating selector row on
  cancel, and moves into the opened document on success.
- **No keyboard trap** (2.1.2): system back cancels; `Escape` on an external
  keyboard cancels; `Enter` submits when the field is non-empty.
- **The filename is part of the dialog's accessible name**, so a screen reader
  user hears which document is locked without exploring: `This document is
  locked. maintenance-log.pdf.`
- **Text scaling**: the dialog grows vertically and scrolls internally past
  175%. The two buttons never sit side by side, so neither can truncate.
