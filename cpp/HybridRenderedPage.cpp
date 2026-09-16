#include "HybridRenderedPage.hpp"

#include <NitroModules/ArrayBuffer.hpp>

namespace margelo::nitro::nitroflipper {

HybridRenderedPage::HybridRenderedPage(::nitroflipper::mupdf::EncodedPage encoded,
                                       ::nitroflipper::mupdf::RawPage raw)
    : HybridObject(TAG),
      HybridRenderedPageSpec(),
      _encoded(std::move(encoded)),
      _raw(std::move(raw)) {}

double HybridRenderedPage::getWidth() { return static_cast<double>(_encoded.width); }
double HybridRenderedPage::getHeight() { return static_cast<double>(_encoded.height); }

double HybridRenderedPage::getDocumentGeneration() {
  return static_cast<double>(_encoded.generations.document);
}

double HybridRenderedPage::getLayoutGeneration() {
  return static_cast<double>(_encoded.generations.layout);
}

double HybridRenderedPage::getStride() { return static_cast<double>(_raw.stride); }
double HybridRenderedPage::getComponents() {
  return static_cast<double>(_raw.components);
}
bool HybridRenderedPage::getPremultiplied() { return _raw.premultiplied; }

std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>>
HybridRenderedPage::toArrayBuffer() {
  // Already in memory: nothing to schedule, so this resolves immediately
  // rather than taking a thread-pool hop to do a copy.
  std::lock_guard<std::mutex> lock(_mutex);
  return Promise<std::shared_ptr<ArrayBuffer>>::resolved(
      ArrayBuffer::copy(_encoded.bytes.data(), _encoded.bytes.size()));
}

std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>>
HybridRenderedPage::toRawArrayBuffer() {
  std::lock_guard<std::mutex> lock(_mutex);
  return Promise<std::shared_ptr<ArrayBuffer>>::resolved(
      ArrayBuffer::copy(_raw.pixels.data(), _raw.pixels.size()));
}

size_t HybridRenderedPage::getExternalMemorySize() noexcept {
  return _encoded.bytes.size() + _raw.pixels.size();
}

}  // namespace margelo::nitro::nitroflipper
