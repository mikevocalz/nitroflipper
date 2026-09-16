# ADR-0001: A narrow RAII adapter over MuPDF's C API, not the generated C++ bindings

Status: accepted
Date: 2026-09-16
Pinned MuPDF: 1.28.4 (upstream tag `ce933bdebe05fe54ba9d69792ed268efd9e00047`)

## Context

MuPDF ships an official C++ binding generator (`scripts/mupdfwrap.py`, written
by Julian Smith) that wraps the whole C API in reference-counted classes and
converts fitz errors into C++ exceptions. Both of those are things we would
otherwise hand-write. The brief asks us to prefer the generated bindings if they
cross-compile for mobile, and to record evidence either way.

So we measured rather than assumed.

## Evidence

Generated on this machine against the pinned 1.28.4 tarball.

**They do cross-compile.** This was the main risk and it did not materialise:

| Measurement | Value |
| --- | --- |
| Generated C++ sources | 5.3 MB across 6 `.cpp` files |
| Generated headers | 1.8 MB across 6 `.h` files |
| Total generated | ~233,000 lines |
| Cross-compile, Android arm64, `-O2` | 7.85 s wall (sequential) |
| Object code, arm64-v8a | 2.9 MB across 6 objects |
| Defined symbols | 9,990 |
| Object format check | `elf64-littleaarch64`, `architecture: aarch64` |

Toolchain: NDK 27.1.12297006, `aarch64-linux-android24-clang++`.

**The cost is on the host side, not the target.** The release tarball contains
no pre-generated bindings — `platform/c++/` does not exist until the generator
runs. Running it requires:

- a host Python with `clang.cindex` (the `libclang` wheel), and
- `pipcl`, which `scripts/wrap/__main__.py` installs *by shelling out to
  `pip install --upgrade pipcl` at import time*.

That last point is the one that decided this. A code generator that performs an
unpinned network install as a side effect of being imported is not something we
want on the critical path of every CI run and every contributor's first build.

## Decision

Implement a narrow RAII adapter over the official C API, in `cpp/mupdf/`.

The engine calls roughly thirty fitz functions. The generated bindings expose
9,990 symbols to serve those thirty. We keep:

- `FzGuard.h` — the `fz_try`/`fz_catch` boundary and typed error translation.
- `FzHandles.h` — one move-only handle per fitz type, each with its own
  `fz_drop_*`.
- `MuPDFDocument` — the document operations the reader actually performs.

## Consequences

Good:

- No host Python, no libclang, no codegen step. `cmake --build` is the whole
  build, on a developer machine and in CI alike.
- The `longjmp` boundary is ours and is auditable in one file. This is the part
  that is genuinely dangerous — a fitz error longjmps past C++ destructors — and
  we would have had to understand it regardless of which binding we used.
- A MuPDF upgrade cannot silently change thousands of wrapper signatures.

Bad:

- We hand-write reference management that the generated bindings would automate.
  Mitigated by `FzHandle` being move-only: there is no copy constructor that
  could take a silent extra reference.
- We give up automatic C++ exception conversion for the whole API and implement
  it for the calls we make. `fzCall` is the single chokepoint, so the exposure
  is bounded.
- If the engine's surface grows several times over, this decision is worth
  revisiting. The measurements above say the target-side cost would be
  acceptable; it is the host toolchain that would still need solving.

## Notes for a future revisit

The `pip install` side effect is an upstream implementation detail, not a
licensing or architectural barrier. If MuPDF ever ships pre-generated bindings
in the release tarball, or removes the self-install, the balance changes and the
2.9 MB/ABI figure above is the number to weigh against a then-larger adapter.
