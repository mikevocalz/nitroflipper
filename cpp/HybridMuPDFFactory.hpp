#pragma once

#include "HybridMuPDFFactorySpec.hpp"

#include <memory>
#include <string>
#include <vector>

namespace margelo::nitro::nitroflipper {

/**
 * The autolinked root. Stateless and default-constructible.
 */
class HybridMuPDFFactory final : public HybridMuPDFFactorySpec {
 public:
  HybridMuPDFFactory();

  std::vector<std::string> getSupportedExtensions() override;

  std::shared_ptr<Promise<std::shared_ptr<HybridMuPDFDocumentSpec>>> openDocument(
      const std::string& path, const std::optional<std::string>& password) override;
};

}  // namespace margelo::nitro::nitroflipper
