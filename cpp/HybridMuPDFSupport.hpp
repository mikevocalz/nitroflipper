#pragma once

// Bridging between DocumentExecutor and Nitro promises.
//
// Promise<T>::async runs on Nitro's thread pool, which does not serialize --
// and MuPDF forbids two threads inside one document. Using it and then
// blocking on the executor would occupy a pool thread per call and put two
// hops in every operation.
//
// So this creates the promise manually and settles it from the executor's own
// worker thread: JS -> executor -> resolve, one hop. Nitro's Promise::resolve
// takes its own lock and hands the value to the JS runtime itself, so calling
// it from our thread is fine. This is the "bridging a native completion API"
// case that justifies a manual Promise; every path below settles exactly once.

#include <NitroModules/Promise.hpp>

#include <exception>
#include <memory>
#include <string>
#include <utility>

#include "mupdf/DocumentExecutor.h"
#include "mupdf/FzGuard.h"

namespace margelo::nitro::nitroflipper {

/** The `code` string JS sees on a rejected promise. */
inline const char* errorCodeString(::nitroflipper::mupdf::ErrorKind kind) {
  using Kind = ::nitroflipper::mupdf::ErrorKind;
  switch (kind) {
    case Kind::Malformed:
      return "malformed";
    case Kind::PasswordRequired:
      return "passwordRequired";
    case Kind::WrongPassword:
      return "wrongPassword";
    case Kind::Unsupported:
      return "unsupported";
    case Kind::OutOfMemory:
      return "outOfMemory";
    case Kind::Cancelled:
      return "cancelled";
    default:
      return "generic";
  }
}

/**
 * Re-throw an engine Error with its kind prefixed onto the message.
 *
 * Nitro turns a std::exception into a JS Error carrying its `what()`. There is
 * no typed-error channel, so the kind is prefixed in a fixed
 * `mupdf/<kind>: <message>` shape that the TypeScript adapter parses back into
 * a discriminated union. Ugly, but explicit, and it keeps the branchable
 * states out of the UI's string matching.
 */
[[noreturn]] inline void rethrowTagged(const ::nitroflipper::mupdf::Error& error) {
  throw std::runtime_error(std::string("mupdf/") + errorCodeString(error.kind()) +
                           ": " + error.what());
}

/**
 * Queue `work` on `executor` and settle `promise` with its result.
 *
 * Runs entirely on the executor's worker thread. Failure settles the promise
 * rather than escaping, so no path leaves a pending promise behind -- an
 * unsettled promise shows up as a reader stuck on its spinner.
 */
template <class T, class Work>
std::shared_ptr<Promise<T>> runOnExecutor(
    const std::shared_ptr<::nitroflipper::mupdf::DocumentExecutor>& executor,
    Work work) {
  using Document = ::nitroflipper::mupdf::MuPDFDocument;
  using Error = ::nitroflipper::mupdf::Error;

  auto promise = Promise<T>::create();

  if (!executor) {
    promise->reject(std::make_exception_ptr(
        std::runtime_error("mupdf/cancelled: document is closed")));
    return promise;
  }

  executor->enqueue([promise, work](Document* document) {
    if (document == nullptr) {
      promise->reject(std::make_exception_ptr(
          std::runtime_error("mupdf/cancelled: document was closed")));
      return;
    }
    try {
      if constexpr (std::is_void_v<T>) {
        work(*document);
        promise->resolve();
      } else {
        promise->resolve(work(*document));
      }
    } catch (const Error& error) {
      promise->reject(std::make_exception_ptr(std::runtime_error(
          std::string("mupdf/") + errorCodeString(error.kind()) + ": " +
          error.what())));
    } catch (...) {
      promise->reject(std::current_exception());
    }
  });

  return promise;
}

}  // namespace margelo::nitro::nitroflipper
