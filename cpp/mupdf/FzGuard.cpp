#include "FzGuard.h"

#include <cstring>

namespace nitroflipper::mupdf {
namespace detail {

namespace {

bool contains(const char* haystack, const char* needle) noexcept {
  return haystack != nullptr && std::strstr(haystack, needle) != nullptr;
}

}  // namespace

ErrorKind classify(int code, const char* message) noexcept {
  // Mapped against enum fz_error_type in include/mupdf/fitz/context.h of the
  // pinned 1.28.4 headers. There is no FZ_ERROR_MEMORY in this release --
  // allocation failure arrives as FZ_ERROR_SYSTEM or FZ_ERROR_LIMIT.
  switch (code) {
    case FZ_ERROR_SYSTEM:  // fatal out of memory or syscall error
    case FZ_ERROR_LIMIT:   // hit a resource or hard limit
      return ErrorKind::OutOfMemory;
    case FZ_ERROR_FORMAT:  // unrecoverable syntax/format error
      return ErrorKind::Malformed;
    case FZ_ERROR_UNSUPPORTED:
      return ErrorKind::Unsupported;
    case FZ_ERROR_ABORT:
      return ErrorKind::Cancelled;
    // FZ_ERROR_SYNTAX is documented as "should be diagnosed and ignored", so a
    // document that raises it is damaged but readable. Reporting it as
    // Malformed would refuse files other readers open, so it falls through to
    // the message check and usually lands on Generic.
    default:
      break;
  }

  // fitz reports encryption through generic errors, so the message is the only
  // signal. Checked against the strings fitz actually emits for encrypted
  // documents; a miss degrades to Generic rather than misreporting, which is
  // why the DRM and password paths each have a fixture.
  if (contains(message, "password")) {
    return ErrorKind::PasswordRequired;
  }
  if (contains(message, "encrypted") || contains(message, "DRM") ||
      contains(message, "not supported")) {
    return ErrorKind::Unsupported;
  }
  if (contains(message, "cannot recognize") || contains(message, "no objects found") ||
      contains(message, "cannot open")) {
    return ErrorKind::Malformed;
  }
  return ErrorKind::Generic;
}

void rethrow(fz_context* ctx) {
  int code = FZ_ERROR_NONE;
  // Hands back code and message and clears ctx->error.errcode in one step.
  // The returned pointer is into context-owned storage that the next fitz call
  // may reuse, so it is copied before anything else touches ctx.
  const char* raw = fz_convert_error(ctx, &code);
  std::string message = raw != nullptr ? raw : "unknown MuPDF error";
  throw Error(classify(code, message.c_str()), std::move(message));
}

void discardError(fz_context* ctx) noexcept {
  // Same clearing step, without caring what it was.
  (void)fz_convert_error(ctx, nullptr);
}

}  // namespace detail
}  // namespace nitroflipper::mupdf
