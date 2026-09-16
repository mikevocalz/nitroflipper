#pragma once

// RAII handles for the fitz objects this engine holds.
//
// Every fitz type is reference counted through its own fz_keep_*/fz_drop_*
// pair, so a single generic handle cannot cover them: the drop function is part
// of the type. FzHandle takes the dropper as a template parameter, which keeps
// each alias one line and makes a mismatched drop a compile error.
//
// Handles are adopted *outside* fz_try (see FzGuard.h). Constructing one inside
// the guard would put a destructor in the longjmp path.

#include <mupdf/fitz.h>
#include <mupdf/pdf.h>

#include <utility>

namespace nitroflipper::mupdf {

/**
 * Owns one reference to a fitz object.
 *
 * Move-only on purpose: copying would need fz_keep_*, and a silent extra
 * reference is exactly the bug that keeps a document alive after close.
 */
template <class T, void (*Drop)(fz_context*, T*)>
class FzHandle {
 public:
  FzHandle() = default;

  /** Adopt an existing reference. Does not call fz_keep_*. */
  FzHandle(fz_context* ctx, T* raw) noexcept : ctx_(ctx), raw_(raw) {}

  FzHandle(const FzHandle&) = delete;
  FzHandle& operator=(const FzHandle&) = delete;

  FzHandle(FzHandle&& other) noexcept
      : ctx_(std::exchange(other.ctx_, nullptr)),
        raw_(std::exchange(other.raw_, nullptr)) {}

  FzHandle& operator=(FzHandle&& other) noexcept {
    if (this != &other) {
      reset();
      ctx_ = std::exchange(other.ctx_, nullptr);
      raw_ = std::exchange(other.raw_, nullptr);
    }
    return *this;
  }

  ~FzHandle() { reset(); }

  void reset() noexcept {
    if (raw_ != nullptr && ctx_ != nullptr) {
      // fz_drop_* is documented never to throw, so no guard is needed and none
      // would be safe: this runs from a destructor.
      Drop(ctx_, raw_);
    }
    raw_ = nullptr;
    ctx_ = nullptr;
  }

  T* get() const noexcept { return raw_; }
  T* operator->() const noexcept { return raw_; }
  explicit operator bool() const noexcept { return raw_ != nullptr; }

  /** Give up ownership without dropping. */
  T* release() noexcept {
    ctx_ = nullptr;
    return std::exchange(raw_, nullptr);
  }

 private:
  fz_context* ctx_ = nullptr;
  T* raw_ = nullptr;
};

using DocumentHandle = FzHandle<fz_document, fz_drop_document>;
using PageHandle = FzHandle<fz_page, fz_drop_page>;
using PixmapHandle = FzHandle<fz_pixmap, fz_drop_pixmap>;
using BufferHandle = FzHandle<fz_buffer, fz_drop_buffer>;
using DeviceHandle = FzHandle<fz_device, fz_drop_device>;
using StextHandle = FzHandle<fz_stext_page, fz_drop_stext_page>;
using OutlineHandle = FzHandle<fz_outline, fz_drop_outline>;
using LinkHandle = FzHandle<fz_link, fz_drop_link>;
using DisplayListHandle = FzHandle<fz_display_list, fz_drop_display_list>;
using StreamHandle = FzHandle<fz_stream, fz_drop_stream>;

/**
 * Owns an fz_context.
 *
 * Dropped last, after every handle above, because fz_drop_* needs a live
 * context. Declaration order inside MuPDFDocument enforces that: the context
 * member is declared first, so it is destroyed last.
 */
class ContextHandle {
 public:
  ContextHandle() = default;
  explicit ContextHandle(fz_context* ctx) noexcept : ctx_(ctx) {}

  ContextHandle(const ContextHandle&) = delete;
  ContextHandle& operator=(const ContextHandle&) = delete;

  ContextHandle(ContextHandle&& other) noexcept
      : ctx_(std::exchange(other.ctx_, nullptr)) {}

  ContextHandle& operator=(ContextHandle&& other) noexcept {
    if (this != &other) {
      reset();
      ctx_ = std::exchange(other.ctx_, nullptr);
    }
    return *this;
  }

  ~ContextHandle() { reset(); }

  void reset() noexcept {
    if (ctx_ != nullptr) {
      fz_drop_context(ctx_);
      ctx_ = nullptr;
    }
  }

  fz_context* get() const noexcept { return ctx_; }
  explicit operator bool() const noexcept { return ctx_ != nullptr; }

 private:
  fz_context* ctx_ = nullptr;
};

}  // namespace nitroflipper::mupdf
