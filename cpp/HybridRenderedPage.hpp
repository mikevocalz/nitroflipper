#pragma once

#include "HybridRenderedPageSpec.hpp"
#include "mupdf/MuPDFDocument.h"

#include <memory>
#include <mutex>

namespace margelo::nitro::nitroflipper {

/**
 * Holds one rendered page's pixels until JS asks for a form of them.
 *
 * Both forms are produced by the same render, so the page is rasterised once
 * and encoded only if toArrayBuffer() is called. That is the whole reason this
 * is a HybridObject: a struct return would have copied both into JS eagerly.
 */
class HybridRenderedPage final : public HybridRenderedPageSpec {
 public:
  HybridRenderedPage(::nitroflipper::mupdf::EncodedPage encoded,
                     ::nitroflipper::mupdf::RawPage raw);

  double getWidth() override;
  double getHeight() override;
  double getDocumentGeneration() override;
  double getLayoutGeneration() override;
  double getStride() override;
  double getComponents() override;
  bool getPremultiplied() override;

  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> toArrayBuffer() override;
  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> toRawArrayBuffer() override;

  /**
   * Tell the JS GC how much native memory this is really holding, so a reader
   * that has paged through a book gets collected under memory pressure instead
   * of the app being killed.
   */
 protected:
  size_t getExternalMemorySize() noexcept override;

 private:
  // Guarded because the two accessors can be called from different JS-side
  // continuations; the buffers are const after construction but the moves out
  // of them are not.
  std::mutex _mutex;
  ::nitroflipper::mupdf::EncodedPage _encoded;
  ::nitroflipper::mupdf::RawPage _raw;
};

}  // namespace margelo::nitro::nitroflipper
