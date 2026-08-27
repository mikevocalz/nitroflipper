#pragma once

#include "ComicArchive.h"
#include "HybridComicArchiveSourceSpec.hpp"

#include <memory>

namespace margelo::nitro::nitroflipper {

class HybridComicArchiveSource : public HybridComicArchiveSourceSpec {
public:
  HybridComicArchiveSource();

  std::shared_ptr<Promise<void>> open(const std::string& path) override;
  void close() override;

  double getPageCount() override;
  ProgressionDirection getProgressionDirection() override;
  SpreadIntent getSpreadIntent() override;

  PageBox getPageBox(double index) override;
  SpreadSlot getSpreadSlot(double index) override;
  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> readEntryBytes(
      double index) override;
  ComicPageLocator locatorForPage(double index) override;

private:
  ::nitroflipper::ComicArchive _archive;
};

} // namespace margelo::nitro::nitroflipper
