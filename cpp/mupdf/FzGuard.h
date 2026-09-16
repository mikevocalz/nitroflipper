#pragma once

// The boundary between MuPDF's C error handling and C++.
//
// fz_try/fz_always/fz_catch are setjmp/longjmp macros. A longjmp that crosses a
// frame holding a C++ object with a non-trivial destructor skips that
// destructor: undefined behaviour, and in practice a leak of whatever the
// object owned. MuPDF's own documentation is explicit that the two error models
// must not be interleaved casually.
//
// The rule this header enforces: the fz_try region contains nothing but C. A
// guarded call returns a raw fz_* pointer or a scalar, and only once control is
// back outside fz_catch does C++ take ownership or throw. Every call into MuPDF
// in this codebase goes through fzCall or fzCallVoid -- there are no bare
// fz_try blocks elsewhere, deliberately.

#include <mupdf/fitz.h>

#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>

namespace nitroflipper::mupdf {

/** What went wrong, in a form the JS layer can branch on. */
enum class ErrorKind {
  Generic,
  /** The file is not a document we can parse at all. */
  Malformed,
  /** Recognised, but needs a password before anything can be read. */
  PasswordRequired,
  /** A password was supplied and rejected. */
  WrongPassword,
  /** Recognised format, but this build cannot open it (DRM, disabled feature). */
  Unsupported,
  /** Allocation refused, either by fitz's budget or the system. */
  OutOfMemory,
  /** The operation was abandoned because the document closed underneath it. */
  Cancelled,
};

class Error : public std::runtime_error {
 public:
  Error(ErrorKind kind, std::string message)
      : std::runtime_error(std::move(message)), kind_(kind) {}

  ErrorKind kind() const noexcept { return kind_; }

 private:
  ErrorKind kind_;
};

namespace detail {

/** Map a caught fitz error code plus its message to our typed kind. */
ErrorKind classify(int code, const char* message) noexcept;

/**
 * Consume the error sitting in `ctx` and throw the C++ equivalent.
 *
 * Called only after fz_catch has returned, so we are outside the setjmp region
 * and throwing is safe. Uses fz_convert_error, which is the call fitz
 * documents for "converting an exception from Fitz to a language binding
 * exception": it hands back the code and message *and* resets errcode to
 * FZ_ERROR_NONE.
 *
 * Clearing is not optional. fz_throw checks whether an errcode is still set
 * and, if so, prints "UNHANDLED EXCEPTION!" and reports the stale error before
 * raising the new one -- so leaving it set makes every later failure log a
 * misleading extra error.
 */
[[noreturn]] void rethrow(fz_context* ctx) noexcept(false);

/** Discard the error in `ctx` without throwing, leaving errcode clear. */
void discardError(fz_context* ctx) noexcept;

}  // namespace detail

/**
 * Run `fn` inside fz_try and translate any fitz error into an Error.
 *
 * `fn` must be C-shaped: no C++ objects with non-trivial destructors may be
 * alive in its frame, because a fitz error longjmps straight past it. Return a
 * raw pointer or a scalar and adopt it into RAII at the call site.
 */
template <class F>
auto fzCall(fz_context* ctx, F&& fn) -> std::invoke_result_t<F> {
  using R = std::invoke_result_t<F>;
  static_assert(std::is_trivially_destructible_v<R>,
                "fzCall must return a trivially destructible type: a longjmp "
                "out of the fz_try region would skip the destructor. Return a "
                "raw fz_* pointer and adopt it outside the guard.");
  R result{};
  bool failed = false;
  fz_try(ctx) {
    result = fn();
  }
  fz_catch(ctx) {
    // Only note that it failed. Throwing here would unwind through the setjmp
    // region itself; reading the error is done outside, where fz_convert_error
    // can also clear it.
    failed = true;
  }
  if (failed) {
    detail::rethrow(ctx);
  }
  return result;
}

/** fzCall for operations that produce nothing. */
template <class F>
void fzCallVoid(fz_context* ctx, F&& fn) {
  bool failed = false;
  fz_try(ctx) {
    fn();
  }
  fz_catch(ctx) {
    failed = true;
  }
  if (failed) {
    detail::rethrow(ctx);
  }
}

/**
 * Like fzCall, but reports failure instead of throwing.
 *
 * For the paths where a failure is an expected answer rather than an error --
 * probing whether a password is needed, reading an optional outline.
 */
template <class F>
bool fzTry(fz_context* ctx, F&& fn) noexcept {
  bool failed = false;
  fz_try(ctx) {
    fn();
  }
  fz_catch(ctx) {
    failed = true;
  }
  if (failed) {
    // Clear it, or the next fz_throw reports this one as unhandled.
    detail::discardError(ctx);
    return false;
  }
  return true;
}

}  // namespace nitroflipper::mupdf
