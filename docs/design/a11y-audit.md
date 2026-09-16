# Accessibility audit — WCAG 2.1 AA

**Verdict: High accessibility risk.**

Two parts, kept strictly apart:

- **Part A** audits the example that exists today — `example/App.tsx`,
  `example/src/ReaderChrome.tsx`, `example/src/readerStore.ts` and
  `src/renderer/PageCurlView.tsx` — by reading the source. Contrast ratios are
  computed from the literal colour values in those files. Every finding here is
  about code that is checked in.
- **Part B** lists the checks that cannot be settled from source and need a
  running build with TalkBack or VoiceOver. Nothing in Part B is a claim.

Baseline is WCAG 2.1 Level A and AA. Where a criterion is AAA it says so —
`2.5.5 Target Size` and `2.3.3 Animation from Interactions` are both AAA in
WCAG 2.1, and both are treated as requirements here for platform and brief
reasons rather than compliance ones.

---

# Part A — audited from the built example

## A1. The book is invisible to a screen reader

**Blocker. WCAG 1.1.1 (A), 4.1.2 (A).**

`PageCurlView` renders a Skia `Canvas` (`src/renderer/PageCurlView.tsx:463`) with
no `accessible`, no `accessibilityRole`, no `accessibilityLabel` and no
`accessibilityActions`. A screen reader reaching the reading surface finds one
unlabelled node containing the entire document.

There is a path to fixing this that the engine already supports:
`MuPDFSource.getPageText(index)` returns the page's text. For EPUB and for PDFs
with a text layer, that string is the page's accessible name and a screen reader
can read the book.

For CBZ and image-only PDFs, `getPageText` returns empty and there is no OCR.
**Those documents are not readable by a screen reader through this library.** The
spec in `handoff/reader-canvas.md` §6.1 makes the fallback label state that
plainly rather than leaving silence.

Fix: `accessible`, `accessibilityRole="image"`, label from `getPageText`,
`accessibilityActions` for `nextPage` / `previousPage` wired to `requestTurn`.

## A2. A turn produces no non-visual feedback

**Blocker. WCAG 4.1.3 (AA).**

`setPageIndex` updates the store; nothing calls
`AccessibilityInfo.announceForAccessibility`. A screen reader user who triggers a
turn gets no confirmation that anything happened, and the canvas has no label
that would change.

Fix: announce the destination on every committed turn, debounced 500ms so a
multi-page flick announces once.

## A3. Reader status disappears with the chrome

**High. WCAG 1.3.1 (A), 4.1.3 (AA).**

`ReaderChrome` returns a bare `Pressable` when `chromeVisible` is false. The page
label is inside the hidden branch, so a reader who has dismissed the controls has
no indication of position at all, visually or programmatically.

Fix: `PageLabelChip` persists when the bar is hidden
(`handoff/reader-canvas.md` §1.1).

## A4. The page-label toggle has no role and no name

**High. WCAG 4.1.2 (A), 2.5.3 (A).**

```jsx
<Pressable onPress={toggleChrome} hitSlop={8}>
  <Text style={styles.label}>{label}</Text>
</Pressable>
```

No `accessibilityRole`, no `accessibilityLabel`. A screen reader announces
`9 of 622` as static text; nothing says it is actionable or what it does. The two
neighbouring arrows are correctly given `accessibilityRole="button"` and
labels — this control was missed.

Fix: `accessibilityRole="button"`, `accessibilityLabel="Page 9 of 622. Hide
reader controls."`, `accessibilityState={{ expanded: true }}`.

## A5. The page-label toggle is below minimum target size

**High. WCAG 2.5.5 (AAA); Material and HIG minimums.**

The two arrows are correctly sized — `styles.tap` sets `minWidth: 44,
minHeight: 44`, and the comment in the file says why. The label between them has
only `hitSlop={8}`. At `fontSize: 15` its measured height is roughly 20dp, giving
a target near **36dp tall** — below the 44 × 44 the same file cites, and below
Material's 48dp.

Fix: give the label the same `styles.tap` treatment with `minHeight: 48`.

## A6. Disabled turn arrows are signalled by opacity alone

**Medium. WCAG 1.4.1 (A).**

`styles.arrowOff` is `rgba(255,255,255,0.28)`. Composited over the bar it lands
between **2.29:1 and 2.52:1** against the bar across the four backgrounds
measured in A7. Disabled controls are exempt from the contrast minima, so this
is not a 1.4.3 failure — but opacity is the only cue, which is a 1.4.1 concern.

React Native's `Pressable` maps its `disabled` prop into
`accessibilityState.disabled`, so the programmatic half is probably covered. It
is listed in Part B because "probably" is not an audit result.

Fix: set `accessibilityState={{ disabled: !canBack }}` explicitly, and at the
start and end of the document suppress the arrow rather than dimming it.

## A7. The control bar's contrast depends on the page behind it

**Medium. WCAG 1.4.3 (AA), 1.4.11 (AA).**

`styles.pill` is `rgba(20,20,20,0.82)` drawn over an arbitrary page raster, so
the label's contrast is a function of the document. Composited and measured at
four representative backgrounds:

| Background | Composite | `#fff` label |
| --- | --- | --- |
| `#222` letterbox | `#171717` | **17.93:1** |
| Light page `#FBFAF7` | `#3E3D3D` | **10.83:1** |
| Pure white panel | `#3E3E3E` | **10.70:1** |
| Mid-tone comic `#99AAAA` | `#2C2F2F` | **13.51:1** |

All four pass. The finding is not that the label fails today — it is that at 82%
opacity over a dark base the ratio happens to stay high, and **nothing in the
code establishes that**. A lighter bar, a higher opacity page, or a switch to a
light UI theme would move it without any check noticing.

Fix: make the bar opaque `chrome.surface`. The ratio becomes a constant —
16.57:1 light, 14.15:1 dark — and hiding the bar is what returns the page.

## A8. The only way to bring the controls back sits on the system gesture area

**High. WCAG 2.5.1 (A), 2.1.1 (A).**

`styles.hitArea` is `position: absolute; left: 0; right: 0; bottom: 0; height: 64`
— the full width of the bottom 64dp. On Android with gesture navigation that
strip contains the system back and home gestures; on a device with a 3-button bar
it sits beneath it. It is also invisible, so nothing indicates it exists.

The chrome is correctly labelled when hidden (`accessibilityRole="button"`,
`accessibilityLabel="Show reader controls"`), so a screen reader user can find
it. A sighted reader cannot.

Fix: a single tap anywhere on the canvas toggles the chrome, arbitrated against
the pan as specified in `handoff/reader-canvas.md` §4.2.

## A9. The page-turn gesture has no non-path alternative on the canvas

**High. WCAG 2.5.1 (A), 2.1.1 (A).**

Prev/next buttons exist in `ReaderChrome` and route through `requestTurn`, which
is the right architecture — the button animates the same curl a drag does. Two
gaps:

- They live inside chrome that can be dismissed, behind the undiscoverable
  reveal target in A8.
- The canvas exposes no `accessibilityActions`, so a screen reader user has to
  leave the reading surface and find the bar to turn a page.

Fix: `accessibilityActions` on the canvas; keep the buttons reachable.

## A10. No reduced-motion path exists

**High. WCAG 2.3.3 (AAA); mandatory in this brief.**

Grepping `src/` and `example/` for `AccessibilityInfo`, `reduceMotion` and
`isReduceMotionEnabled` returns nothing. The curl runs at
`withTiming(1, { duration: 280 })` (`PageCurlView.tsx:437`),
`withTiming(1, { duration: 320 })` (`:190`) and
`withSpring({ damping: 20, stiffness: 180 })` (`:442`) regardless of the system
setting.

A full-page conical deformation is a large, fast, screen-filling motion — the
class of animation that triggers vestibular symptoms.

Fix: `tokens.md` §5.3. Every turn still happens and still announces; the page
does not deform. The drag still works — direction and threshold are still read.

## A11. The error state is a red string with no way out

**High. WCAG 1.4.1 (A), 3.3.1 (A), 3.3.3 (AA).**

```jsx
<Text style={styles.error}>{error}</Text>   // color: '#ff6b6b'
```

`#ff6b6b` on `#222` is **5.73:1**, which passes 1.4.3. Everything else fails:

- Colour is the only indicator that this is an error — no icon, no heading.
- The content is `String(e)`, a raw exception. `DocumentError` already carries a
  parsed `kind` that the UI could branch on, and it is thrown away here.
- No action. No retry, no back, no way to choose another document. The app is
  finished.
- `onPageLoadError` routes into the same `setError`, so **one unrenderable page
  replaces the entire reader**.

Fix: `handoff/error.md`, five kind-specific screens plus the inline treatments
in §3 of that file.

## A12. The loading state has no status semantics and appears instantly

**Medium. WCAG 4.1.3 (AA).**

`ActivityIndicator` plus `Loading EPUB…`, rendered from the first frame with no
`accessibilityRole="progressbar"`, no `accessibilityLiveRegion` and no
`accessibilityValue`. A screen reader user gets nothing announced; a sighted user
gets a spinner flash on a fast open.

Fix: `handoff/loading.md` — nothing under 400ms, then a skeleton, then
determinate progress with `progressbar` semantics and a polite live region on the
stage label.

## A13. The reading surface is `#222` in every theme

**Medium. WCAG 1.4.3 (AA) in effect, 1.4.8 (AAA) in intent.**

`App.tsx` sets `container.backgroundColor: '#222'` unconditionally. `useColorScheme`
is read, and its only use is `StatusBar barStyle`. There is no light theme, no
sepia, and no way to choose one — a dark letterbox is forced around every page
including a white one, which is the highest-glare combination available.

Fix: `tokens.md` §3.2 plus `handoff/appearance.md`.

## A14. RTL books page the wrong way with nothing said

**High. WCAG 1.3.2 (A), 3.2.4 (AA).**

`PageCurlView` mirrors the drag correctly when `progressionDirection` is `rtl`.
`MuPDFSource` hardcodes it to `ltr` because the engine does not read the EPUB
spine's `page-progression-direction` — documented in
`docs/mupdf-integration-status.md`. A manga or an Arabic EPUB pages backwards and
the interface offers no correction.

Fix: reading direction as a user control (`handoff/appearance.md` §2) until the
engine reads the spine.

## A15. There is no document selector

**Medium. WCAG 2.4.5 (AA).**

`const FORMAT: 'cbz' | 'pdf' | 'epub' = 'epub'` in `App.tsx`. Changing document
requires editing source and rebuilding. Nothing in the running app reaches more
than one document.

Fix: `handoff/document-selector.md`.

---

## Part A summary

| ID | Severity | Criteria |
| --- | --- | --- |
| A1 | Blocker | 1.1.1 A, 4.1.2 A |
| A2 | Blocker | 4.1.3 AA |
| A3 | High | 1.3.1 A, 4.1.3 AA |
| A4 | High | 4.1.2 A, 2.5.3 A |
| A5 | High | 2.5.5 AAA |
| A8 | High | 2.5.1 A, 2.1.1 A |
| A9 | High | 2.5.1 A, 2.1.1 A |
| A10 | High | 2.3.3 AAA |
| A11 | High | 1.4.1 A, 3.3.1 A, 3.3.3 AA |
| A14 | High | 1.3.2 A, 3.2.4 AA |
| A6 | Medium | 1.4.1 A |
| A7 | Medium | 1.4.3 AA, 1.4.11 AA |
| A12 | Medium | 4.1.3 AA |
| A13 | Medium | 1.4.3 AA |
| A15 | Medium | 2.4.5 AA |

**Criteria that pass in the built example:** 1.4.3 for the visible bar label
(10.70:1 to 17.93:1 across four measured backgrounds) and for the error text
(5.73:1); 2.5.5 for the two turn arrows (44 × 44dp, deliberately, with the reason
in a comment). The turn arrows are the only part of the current chrome that was
designed for accessibility, and they were designed correctly.

---

# Part B — spec-level checks that need a running build

None of these can be resolved from source. The library has never rendered a frame
on a device, so all of them are open.

## B1. Screen reader behaviour

- Does TalkBack reach the Skia `Canvas` at all once it is marked `accessible`, or
  does Fabric's view flattening remove it?
- Does `accessibilityActions` on a Skia canvas surface as TalkBack's local
  context menu, and are the action names announced?
- Does `announceForAccessibility` fire reliably during a Reanimated UI-thread
  animation, or is it dropped while the curl runs?
- Does `Pressable`'s `disabled` prop actually reach `accessibilityState.disabled`
  in TalkBack on RN 0.86.3 (A6)?
- Does a 2,400-character `getPageText` result work as an `accessibilityLabel`, or
  does TalkBack truncate it? If it truncates, the page has to be chunked into
  paragraph-level nodes, which is a different design.
- VoiceOver rotor: does the reader appear as one image or as navigable text?

## B2. Reduced motion

- Does `AccessibilityInfo.isReduceMotionEnabled()` reflect Android's
  `Settings.Global.TRANSITION_ANIMATION_SCALE` on the Surface Duo's Android 12L?
- Does the `reduceMotionChanged` subscription fire while the app is foregrounded,
  or only on next launch?
- With the curl at 0ms, does the destination page arrive on the next frame or is
  there a visible blank? The texture may not be cached.

## B3. Contrast in practice

- Every ratio in `tokens.md` is computed from hex pairs. None has been measured
  on a Surface Duo panel, which has its own gamma.
- Outdoor legibility of `page.sepia` `#F2E6D0` with `#3B3025` text (10.40:1
  nominal) at maximum brightness.
- The `hit.fill` `#FFE08A` mark drawn over a **rendered page raster**, not over a
  flat token colour. A match landing on a grey figure has a different ratio than
  one on white paper, which is why `hit.rule` exists — and whether the rule is
  visible over a dark figure is unverified.

## B4. Touch targets on hardware

- 48dp targets with gloves on, which is Tom's actual condition.
- Whether any target lands within `fold.safeInset` of the real hinge. The hinge
  bounds come from `FoldingFeature` at runtime and **no fold API is wired in the
  example at all** — `gutter={0}` is passed as a constant. Every dual-screen
  measurement in the handoff specs is therefore unvalidated.

## B5. Focus order and keyboard

- Focus order with an external keyboard on the Duo spanned: does traversal go
  down the left leaf then the right, or does it interleave?
- Does focus return correctly to the opening control after a panel dismiss?
- `Escape` handling on Android with a hardware keyboard.
- Whether the phone sheets trap focus (2.1.2) as specified, and whether the Duo
  panels correctly do not.

## B6. Text scaling

- The bar's two-row wrap above 130% font scale
  (`handoff/reader-canvas.md` §6.7) is specified from measurement arithmetic, not
  from a screenshot.
- Whether MuPDF's own relayout at `fontSizePt: 24` interacts sensibly with a
  system font scale of 200%. Two independent scale factors multiply, and nothing
  has checked the result.
- Whether the segmented controls in `handoff/appearance.md` actually stack rather
  than truncating at 200%.

## B7. The password screen in full

`docs/mupdf-integration-status.md` records password handling as written and
untested — there is no protected fixture. Every accessibility statement in
`handoff/password.md` describes a screen that has never run.

## B8. DRM detection

The detection rules in `handoff/error.md` §2.3 — `META-INF/encryption.xml` for
EPUB, a non-`/Standard` `/Encrypt` filter for PDF — are **not implemented and not
tested**. Until they are, a DRM file lands on the `malformed` or `unsupported`
screen.

---

## Priority

1. **A1 + A2** — give the canvas a name and announce turns. Without these the
   reader is unusable with a screen reader, and both are small changes against an
   engine method that already exists.
2. **A11** — replace `String(e)` with the kind-specific screens, and stop a
   single page-render failure from taking down the whole reader.
3. **A8 + A9** — tap-to-toggle on the canvas, `accessibilityActions` on the
   canvas, and prev/next that stays reachable.
4. **A10** — the reduced-motion path. A screen-filling page deformation with no
   opt-out is the highest-severity motion issue this library can have.
5. **A4 + A5** — role, name and a 48dp target on the page-label toggle. Two small
   fixes on a control the surrounding code already got right.
