# Reading-task research brief

Written 2026-09-16 against `docs/mupdf-integration-status.md` at commit `aac2d70`.

Scope: the `example/` reader that demonstrates `nitro-flipper`. This brief covers
what the reader is for, who uses it, how we will know it works, and the script to
run once there is a build on hardware.

Nothing in this document assumes a capability the engine does not have. Where a
design leans on something unbuilt it is marked **Aspirational** and carries the
reason.

---

## What the engine can and cannot do today

Everything below is taken from `docs/mupdf-integration-status.md` and the source,
not from the library's ambitions. The design is bounded by this table.

| Capability | State | Design consequence |
| --- | --- | --- |
| Open PDF, EPUB, CBZ from a file path | Works, tested on host + Surface Duo | The selector opens a path, not a URL or a store item |
| Two-page spread across the fold | Works, verified on Surface Duo | Spread is a first-class layout, not a tablet afterthought |
| Page turn with curl | Works | Curl is the animation of a turn, not the mechanism of one |
| Outline (`getOutline`) | Runs, unproven on real text documents | TOC screen designed; empty and unreliable states designed with it |
| Search (`search`, cancellable) | Runs, unproven on real text documents | Search screen designed; zero-result and image-only-PDF states designed with it |
| Password (`authenticate`) | Written, no protected fixture | Password screen designed; marked unverified in the a11y audit |
| Relayout at a new font size | Works, anchor survives (`fz_make_bookmark`) | Appearance screen can change size without losing the reader's place |
| Persistent locator | Works, versioned (ADR-0004) | Bookmarks store a locator string, not a page number |
| **Text selection / highlight** | **Not implemented anywhere** | No selection handles, no highlight menu, no long-press affordance. Long-press stays unclaimed |
| **OCR of image-only PDFs** | **Not implemented** | Search must explain a zero-hit scan rather than imply the words are absent |
| **DRM** | **Cannot open** | Dedicated refusal state, distinct from corruption |
| **EPUB `page-progression-direction`** | **Not read** — hardcoded `ltr` in `MuPDFSource` | RTL becomes a visible user setting, not a silent wrong-way book |
| Anything at run time on Android | Library links; no rendered frame measured | Every latency number below is a target to measure, not an observation |

---

## The three reading tasks

The reader serves three tasks with genuinely different success conditions. They
are not three flavours of the same job, and where they conflict this brief says
which one wins.

### 1. Long-form reading (EPUB, reflowable)

The reader reads for 20 to 90 minutes, mostly forward, mostly one page at a time,
often one-handed. They change font size once at the start of a book and then never
again. They lose their place when the app is killed and expect to get it back.

The interface's job is to disappear. Chrome is hidden by default while reading;
the only persistent element is the page label. Every turn must feel identical to
the last — a turn that sometimes takes 40 ms and sometimes 400 ms reads as a
broken book even when both are fast in the abstract.

**Wins over the other two when:** deciding default chrome visibility, default
spread behaviour on a phone, and how much the page label is allowed to move.

### 2. Reference lookup (PDF, fixed layout)

The reader is looking for one thing in a 300-page manual: a part number, a
clause, a diagram. They arrive with intent, use the TOC or search, jump, read
half a page, and leave. They may do this four times in ten minutes.

The interface's job is to be fast to enter and fast to leave. Search and TOC must
be reachable in one tap from the reading surface, and jumping to a result must
leave a way back to where they were. A reference reader who loses their original
page to a search jump has been made worse off by the feature.

**Wins over the other two when:** deciding whether search and TOC get top-level
controls (they do), and whether a jump is undoable (it is).

### 3. Comics (CBZ and fixed-layout PDF/EPUB)

The reader wants the art at maximum size with nothing on top of it. On a Surface
Duo a two-page spread must pair correctly, with the fold as the gutter — a spread
paired one page out is the single most visible failure this library can produce.
Double-width pages (drawn spreads) must show alone across the viewport, which
`PageCurlView` already does.

The interface's job is to get out of the frame. Chrome overlays a comic at 82%
opacity today; the spec below moves it to a dockable bar so it never sits over
artwork during a read.

**Wins over the other two when:** deciding overlay opacity, scrim policy over
the page, and whether spread pairing is ever overridden automatically.

---

## Personas

Three, one per task. Each is a composite; none is a research finding. They exist
to make the tradeoffs above arguable, not to substitute for talking to readers.

### Nadia — long-form

34, product manager, reads on a Pixel 8 in portrait on a 28-minute tram ride.
Two or three novels a month, all EPUB, all sideloaded. Holds the phone in her
left hand and turns with her left thumb, which means her turn gesture starts near
the left edge and travels right — a backward drag in LTR terms. She has never
opened a reading-settings screen after the first session of a book.

What breaks her session: losing her place after an app kill; a turn that stutters;
chrome appearing when she adjusts her grip.

### Tom — reference

48, field service engineer, Surface Duo spanned on a bench, gloves half the time.
Opens a 420-page equipment PDF, usually to one of six sections he already knows
by name. Types short search terms with one finger. Reads two facing pages, checks
a figure on the right-hand leaf, then closes.

What breaks his session: a search that returns nothing because the scan has no
text layer and does not say so; a TOC entry that jumps to the wrong place after
a relayout; a jump he cannot undo.

### Kofi — comics

22, reads CBZ scans on a Surface Duo specifically because the fold makes a real
gutter. Notices pairing errors instantly. Turns fast, often four or five pages
in a row, and expects each flick to register.

What breaks his session: a spread paired one page out; chrome over artwork; a
flick that is swallowed because the previous turn had not finished.

---

## Success metrics

Two sets, kept apart because one can be measured from a device build and the
other needs readers in front of it.

### Instrumented (needs a build on hardware — none of these have been measured)

| Metric | Target | Why this number |
| --- | --- | --- |
| Time to first rendered page, 12 MB PDF, cold | ≤ 1200 ms on Surface Duo | Past ~1 s an opening document needs a progress affordance; the loading screen spec assumes this and switches representation at 800 ms |
| Turn-to-turn latency, forward, cached neighbour | ≤ 50 ms from gesture release to committed index | The curl animates for 280 ms; any JS work on top of that is visible |
| Dropped frames during a curl | 0 over a 60-turn run | The curl runs entirely on the UI thread today (one shared value, per-pixel shader). A dropped frame means something regressed to JS |
| Spread pairing correctness | 100% over the full CBZ and PDF fixtures | One error is disqualifying for Kofi's task |
| Position restore after process death | Exact page on fixed layout; same paragraph on reflowable at a changed font size | ADR-0004 claims this; it is untested end to end |
| Peak texture memory | ≤ the configured `textureBudgetBytes` (default 47.5 MB) with no eviction of a sampled texture | `PageTextureCache` tests assert the rule; a device run has never exercised it |

### Behavioural (needs the usability sessions below)

| Metric | Target | Method |
| --- | --- | --- |
| Turn success on first attempt | ≥ 95% of attempted turns | Observed in task 2 |
| Time to find a known item in a 400-page PDF | median ≤ 45 s | Task 4, timed from reading surface to the target page on screen |
| Unprompted discovery of prev/next controls | ≥ 4 of 6 participants without being told | Task 3 |
| Participants who lose their place during a font-size change | 0 | Task 5 |
| Participants who read a zero-hit image-only search as "the word isn't in the book" | 0 | Task 6; this is a copy test, and the current copy has never been read by anyone |

---

## What research to run, and what not to

The example UI is at the **Design** phase: the shape is decided, the questions are
about friction in specific flows. That points at moderated usability testing —
behavioural and qualitative, scripted use — rather than surveys or A/B tests.

**Run now, once there is an installable build:**

- **Moderated usability testing, 6 participants, 2 per task type.** Six finds the
  friction; it cannot tell you what percentage of readers hit it, and this brief
  does not ask it to.
- **One device-lab session on a real Surface Duo, spanned.** The fold behaviour
  cannot be evaluated on an emulator or a tablet. Two of the six sessions should
  be on hardware, ideally Tom and Kofi.

**Run later, deliberately not now:**

- **Usability benchmarking.** Summative metrics need a stable build. Nothing has
  rendered a frame on a device, so any benchmark today measures the harness.
- **A diary study of commute reading.** Genuinely the right method for Nadia's
  task, and worth doing once the reader is stable enough to live on a phone for a
  fortnight. Running it against the current example would collect complaints about
  a hardcoded fixture switch.

**Do not run:**

- **A survey asking which reading features people want.** Attitudinal data cannot
  diagnose why a turn failed, and the open questions here are all behavioural.
- **A/B testing curl variants.** There is no traffic, and the variable that
  matters (does the turn register) is a pass/fail, not a preference.

---

## Usability test script

45 minutes. Two devices: a phone in portrait and a Surface Duo spanned. Fixtures:
a 420-page text PDF with a real outline, a reflowable EPUB novel, a CBZ comic, a
password-protected PDF, and an image-only scanned PDF with no text layer.

Moderator reads the task, then stops talking. Record screen and hands; hands are
where turn failures are visible.

**Warm-up (3 min).** "Tell me what you read on your phone, and what you last read
on it." Do not describe the app.

**Task 1 — Open (3 min).** *"Open the novel."* Watch: do they find the selector's
recent list or go to the file browser? Does the loading state read as progress or
as a hang?

**Task 2 — Read forward (6 min).** *"Read the first few pages as you normally
would."* Say nothing about gestures. Count attempted turns and successful turns.
Note which edge they start the drag from and whether they ever tap instead of
drag.

**Task 3 — Turn without swiping (4 min).** *"Turn the page without swiping."*
Success is finding the prev/next control. Failure modes to record: tapping the
page edge, pressing the volume key, giving up. Follow up: *"Where did you expect
that to be?"*

**Task 4 — Find a known item (6 min).** Surface Duo, spanned, 420-page PDF.
*"Find the torque spec for the drive coupling."* Timed. Record whether they reach
for TOC or search first, and whether they get back to their original page
afterwards without being asked to.

**Task 5 — Make the text bigger (5 min).** Reflowable EPUB, mid-chapter.
*"Make the text more comfortable to read."* Before they start, ask them to
remember the sentence they are on. After the change: *"Find that sentence."*
Any hunting is a failure of the anchor, not of the reader.

**Task 6 — Search a scan (5 min).** Image-only PDF. *"Find every mention of
'bearing'."* The correct outcome is zero hits. Ask afterwards: *"What does that
result tell you about this document?"* If they say the word is not in it, the
copy has failed.

**Task 7 — Locked document (4 min).** *"Open the maintenance log."* It is password
protected; give them the wrong password on a slip of paper first, the right one
second. Watch the error recovery, not the success.

**Task 8 — Comics on the fold (6 min).** Surface Duo, spanned, CBZ.
*"Read this until you hit something that looks wrong."* Record whether they spot
the double-width page being shown alone and whether they read that as correct or
as a bug.

**Wrap (3 min).** *"What would you change first?"* Then: *"Was there a moment you
were not sure the app had heard you?"* — the second question surfaces H1 status
failures that participants do not volunteer.

### What each task decides

| Task | Decides |
| --- | --- |
| 1 | Whether the selector's recent list earns its place above the file browser |
| 2 | The pan gesture's activation thresholds, and whether tap-to-turn is needed at all |
| 3 | Whether prev/next can stay inside the hidden chrome or must be persistent |
| 4 | TOC-vs-search default ordering, and whether "back to page N" needs to be an explicit control |
| 5 | Whether the appearance sheet can be a bottom sheet or must be a side panel that keeps text visible |
| 6 | The exact wording of the image-only search result |
| 7 | Whether the wrong-password copy distinguishes itself from the corrupt-file copy |
| 8 | Whether double-width pages need an explicit label |
