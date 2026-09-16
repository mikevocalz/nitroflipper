#pragma once

#include "HybridMuPDFDocumentSpec.hpp"
#include "mupdf/DocumentExecutor.h"

#include <memory>
#include <string>

namespace margelo::nitro::nitroflipper {

/**
 * JS-facing handle for one open document.
 *
 * Owns the executor, and therefore the worker thread and the fitz context.
 * Not autolinked: MuPDFFactory::openDocument is the only way to get one,
 * because a default-constructed instance would have no document and every
 * method on it would have to fail.
 *
 * Synchronous getters read the executor's published snapshot rather than the
 * document, so they never block on the worker and never see a half-applied
 * relayout.
 */
class HybridMuPDFDocument final : public HybridMuPDFDocumentSpec {
 public:
  explicit HybridMuPDFDocument(
      std::shared_ptr<::nitroflipper::mupdf::DocumentExecutor> executor);
  ~HybridMuPDFDocument() override;

  double getPageCount() override;
  bool getIsReflowable() override;
  std::string getFormat() override;
  double getDocumentGeneration() override;
  double getLayoutGeneration() override;
  DocumentSnapshot getSnapshot() override;

  std::shared_ptr<Promise<void>> setStyle(const DocumentStyle& style) override;
  std::shared_ptr<Promise<void>> layout(const DocumentLayout& layout) override;
  std::shared_ptr<Promise<DocumentPageBox>> getPageBox(double pageNumber) override;
  std::shared_ptr<Promise<DocumentLocation>> locationForPage(double pageNumber) override;
  std::shared_ptr<Promise<std::string>> locatorForPage(double pageNumber) override;
  std::shared_ptr<Promise<double>> pageForLocator(const std::string& locator) override;
  std::shared_ptr<Promise<std::shared_ptr<HybridRenderedPageSpec>>> renderPage(
      double pageNumber, double maxWidth, double maxHeight) override;
  std::shared_ptr<Promise<std::vector<OutlineEntry>>> getOutline() override;
  std::shared_ptr<Promise<std::vector<SearchResult>>> search(
      const std::string& needle, double maxHits) override;
  std::shared_ptr<Promise<std::string>> getPageText(double pageNumber) override;
  std::shared_ptr<Promise<bool>> authenticate(const std::string& password) override;
  void close() override;

 private:
  std::shared_ptr<::nitroflipper::mupdf::DocumentExecutor> _executor;
};

}  // namespace margelo::nitro::nitroflipper
