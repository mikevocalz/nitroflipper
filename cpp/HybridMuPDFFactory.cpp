#include "HybridMuPDFFactory.hpp"

#include "HybridMuPDFDocument.hpp"
#include "HybridMuPDFSupport.hpp"
#include "mupdf/DocumentExecutor.h"

namespace margelo::nitro::nitroflipper {

namespace engine = ::nitroflipper::mupdf;

HybridMuPDFFactory::HybridMuPDFFactory()
    : HybridObject(TAG), HybridMuPDFFactorySpec() {}

std::vector<std::string> HybridMuPDFFactory::getSupportedExtensions() {
  // Matches the handlers compiled in by third_party/mupdf/CMakeLists.txt. XPS
  // and SVG are deliberately absent; adding them here without enabling them
  // there would offer the picker a file we then fail to open.
  return {"pdf", "epub", "xhtml", "html", "fb2", "mobi", "txt", "cbz"};
}

std::shared_ptr<Promise<std::shared_ptr<HybridMuPDFDocumentSpec>>>
HybridMuPDFFactory::openDocument(const std::string& path,
                                 const std::optional<std::string>& password) {
  auto promise = Promise<std::shared_ptr<HybridMuPDFDocumentSpec>>::create();

  // The executor is created here rather than inside the job so that the
  // document handle can own it from the moment the open starts -- otherwise a
  // close arriving mid-open would have nothing to cancel.
  auto executor = engine::DocumentExecutor::make();
  const std::string pw = password.value_or(std::string{});

  // Parsing happens in the job; the promise settles only after the snapshot
  // has been published. Resolving inside the job let JS read pageCount before
  // the open had published one, so a freshly opened book reported 0 pages and
  // prefetched no page boxes.
  auto settle = std::make_shared<std::function<void()>>();

  executor->enqueue(
      [promise, executor, path, pw, settle](engine::MuPDFDocument* document) {
        if (document == nullptr) {
          *settle = [promise] {
            promise->reject(std::make_exception_ptr(std::runtime_error(
                "mupdf/cancelled: closed before open completed")));
          };
          return;
        }
        try {
          document->open(path, pw);
          *settle = [promise, executor] {
            promise->resolve(std::make_shared<HybridMuPDFDocument>(executor));
          };
        } catch (const engine::Error& error) {
          // The executor is dropped with this lambda, taking its worker thread
          // and fitz context with it. A failed open leaves nothing running.
          auto message = std::string("mupdf/") + errorCodeString(error.kind()) +
                         ": " + error.what();
          *settle = [promise, message] {
            promise->reject(
                std::make_exception_ptr(std::runtime_error(message)));
          };
        } catch (...) {
          auto captured = std::current_exception();
          *settle = [promise, captured] { promise->reject(captured); };
        }
      },
      [settle] {
        if (*settle) (*settle)();
      });

  return promise;
}

}  // namespace margelo::nitro::nitroflipper
