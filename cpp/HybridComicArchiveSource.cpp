#include "HybridComicArchiveSource.hpp"

#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/Promise.hpp>

namespace margelo::nitro::nitroflipper {

using namespace margelo::nitro;

namespace native = ::nitroflipper;

static ProgressionDirection toNitro(native::ProgressionDirection dir) {
  switch (dir) {
    case native::ProgressionDirection::Rtl:
      return ProgressionDirection::RTL;
    default:
      return ProgressionDirection::LTR;
  }
}

static SpreadIntent toNitro(native::SpreadIntent intent) {
  switch (intent) {
    case native::SpreadIntent::None:
      return SpreadIntent::NONE;
    case native::SpreadIntent::Landscape:
      return SpreadIntent::LANDSCAPE;
    case native::SpreadIntent::Portrait:
      return SpreadIntent::PORTRAIT;
    case native::SpreadIntent::Both:
      return SpreadIntent::BOTH;
    default:
      return SpreadIntent::AUTO;
  }
}

static SpreadSlot toNitro(native::SpreadSlot slot) {
  switch (slot) {
    case native::SpreadSlot::Left:
      return SpreadSlot::LEFT;
    case native::SpreadSlot::Right:
      return SpreadSlot::RIGHT;
    case native::SpreadSlot::Center:
      return SpreadSlot::CENTER;
    default:
      return SpreadSlot::AUTO;
  }
}

HybridComicArchiveSource::HybridComicArchiveSource()
    : HybridObject(TAG), HybridComicArchiveSourceSpec() {}

std::shared_ptr<Promise<void>> HybridComicArchiveSource::open(
    const std::string& path) {
  return Promise<void>::async([this, path]() {
    if (!_archive.open(path)) {
      throw std::runtime_error("Failed to open comic archive: " + path);
    }
  });
}

void HybridComicArchiveSource::close() { _archive.close(); }

double HybridComicArchiveSource::getPageCount() {
  return static_cast<double>(_archive.pageCount());
}

ProgressionDirection HybridComicArchiveSource::getProgressionDirection() {
  return toNitro(_archive.progressionDirection());
}

SpreadIntent HybridComicArchiveSource::getSpreadIntent() {
  return toNitro(_archive.spreadIntent());
}

PageBox HybridComicArchiveSource::getPageBox(double index) {
  native::PageBox box = _archive.page(static_cast<size_t>(index)).box;
  PageBox result;
  result.width = static_cast<double>(box.width);
  result.height = static_cast<double>(box.height);
  return result;
}

SpreadSlot HybridComicArchiveSource::getSpreadSlot(double index) {
  return toNitro(_archive.page(static_cast<size_t>(index)).slot);
}

std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>>
HybridComicArchiveSource::readEntryBytes(double index) {
  return Promise<std::shared_ptr<ArrayBuffer>>::async([this, index]() {
    auto bytes = _archive.readPageBytes(static_cast<size_t>(index));
    return ArrayBuffer::copy(
        reinterpret_cast<const uint8_t*>(bytes.data()), bytes.size());
  });
}

ComicPageLocator HybridComicArchiveSource::locatorForPage(double index) {
  const size_t i = static_cast<size_t>(index);
  const double count = static_cast<double>(_archive.pageCount());

  PageLocation loc;
  loc.progression = count > 0.0 ? (static_cast<double>(i) / count) : 0.0;

  ComicPageLocator result;
  result.href = "page://" + std::to_string(i);
  result.locations = std::move(loc);
  return result;
}

} // namespace margelo::nitro::nitroflipper
