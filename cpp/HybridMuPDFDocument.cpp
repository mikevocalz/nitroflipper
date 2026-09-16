#include "HybridMuPDFDocument.hpp"

#include "HybridMuPDFSupport.hpp"
#include "HybridRenderedPage.hpp"

namespace margelo::nitro::nitroflipper {

namespace engine = ::nitroflipper::mupdf;

HybridMuPDFDocument::HybridMuPDFDocument(
    std::shared_ptr<engine::DocumentExecutor> executor)
    : HybridObject(TAG), HybridMuPDFDocumentSpec(), _executor(std::move(executor)) {}

HybridMuPDFDocument::~HybridMuPDFDocument() {
  // If JS dropped this without calling close(), the executor still has to be
  // drained before its document is destroyed. Doing it here means a forgotten
  // close leaks nothing worse than a late teardown.
  if (_executor) {
    _executor->shutdown();
  }
}

// --- Snapshot reads ---------------------------------------------------------
// All of these read the published snapshot. None touch the document, so none
// can block behind a render on the worker thread.

double HybridMuPDFDocument::getPageCount() {
  if (!_executor) return 0.0;
  return static_cast<double>(_executor->publishedSnapshot().pageCount);
}

bool HybridMuPDFDocument::getIsReflowable() {
  if (!_executor) return false;
  return _executor->publishedSnapshot().reflowable;
}

std::string HybridMuPDFDocument::getFormat() {
  if (!_executor) return {};
  return _executor->publishedSnapshot().format;
}

double HybridMuPDFDocument::getDocumentGeneration() {
  if (!_executor) return 0.0;
  return static_cast<double>(_executor->publishedGenerations().document);
}

double HybridMuPDFDocument::getLayoutGeneration() {
  if (!_executor) return 0.0;
  return static_cast<double>(_executor->publishedGenerations().layout);
}

DocumentSnapshot HybridMuPDFDocument::getSnapshot() {
  DocumentSnapshot out;
  if (!_executor) {
    // A closed document reports an empty one rather than stale numbers, so UI
    // bound to this cannot keep rendering a book that is gone.
    out.pageCount = 0;
    out.isReflowable = false;
    out.needsPassword = false;
    out.format = "";
    out.documentGeneration = 0;
    out.layoutGeneration = 0;
    return out;
  }
  const engine::Snapshot snap = _executor->publishedSnapshot();
  out.pageCount = static_cast<double>(snap.pageCount);
  out.isReflowable = snap.reflowable;
  out.needsPassword = snap.needsPassword;
  out.format = snap.format;
  out.documentGeneration = static_cast<double>(snap.generations.document);
  out.layoutGeneration = static_cast<double>(snap.generations.layout);
  return out;
}

// --- Async operations -------------------------------------------------------

std::shared_ptr<Promise<void>> HybridMuPDFDocument::setStyle(
    const DocumentStyle& style) {
  engine::StyleOptions options;
  options.usePublisherStyles = style.usePublisherStyles;
  options.userCss = style.userCss;
  return runOnExecutor<void>(_executor, [options](engine::MuPDFDocument& doc) {
    doc.style(options);
  });
}

std::shared_ptr<Promise<void>> HybridMuPDFDocument::layout(
    const DocumentLayout& layout) {
  engine::LayoutOptions options;
  options.width = static_cast<float>(layout.width);
  options.height = static_cast<float>(layout.height);
  options.fontSizePt = static_cast<float>(layout.fontSizePt);
  return runOnExecutor<void>(_executor, [options](engine::MuPDFDocument& doc) {
    doc.layout(options);
  });
}

std::shared_ptr<Promise<DocumentPageBox>> HybridMuPDFDocument::getPageBox(
    double pageNumber) {
  const int page = static_cast<int>(pageNumber);
  return runOnExecutor<DocumentPageBox>(
      _executor, [page](engine::MuPDFDocument& doc) {
        const engine::PageBox box = doc.pageBox(doc.locationFromPageNumber(page));
        DocumentPageBox out;
        out.width = static_cast<double>(box.width);
        out.height = static_cast<double>(box.height);
        return out;
      });
}

std::shared_ptr<Promise<DocumentLocation>> HybridMuPDFDocument::locationForPage(
    double pageNumber) {
  const int page = static_cast<int>(pageNumber);
  return runOnExecutor<DocumentLocation>(
      _executor, [page](engine::MuPDFDocument& doc) {
        const engine::Location loc = doc.locationFromPageNumber(page);
        DocumentLocation out;
        out.chapter = static_cast<double>(loc.chapter);
        out.page = static_cast<double>(loc.page);
        out.pageNumber = static_cast<double>(doc.pageNumberFromLocation(loc));
        return out;
      });
}

std::shared_ptr<Promise<std::string>> HybridMuPDFDocument::locatorForPage(
    double pageNumber) {
  const int page = static_cast<int>(pageNumber);
  return runOnExecutor<std::string>(_executor, [page](engine::MuPDFDocument& doc) {
    return doc.locatorFor(doc.locationFromPageNumber(page));
  });
}

std::shared_ptr<Promise<double>> HybridMuPDFDocument::pageForLocator(
    const std::string& locator) {
  return runOnExecutor<double>(_executor, [locator](engine::MuPDFDocument& doc) {
    const auto location = doc.locationFromLocator(locator);
    if (!location.has_value()) {
      // -1 rather than a rejection: an unresolvable saved position is an
      // ordinary outcome when a book has been replaced, and the caller should
      // fall back to page one rather than show an error.
      return -1.0;
    }
    return static_cast<double>(doc.pageNumberFromLocation(*location));
  });
}

std::shared_ptr<Promise<std::shared_ptr<HybridRenderedPageSpec>>>
HybridMuPDFDocument::renderPage(double pageNumber, double maxWidth,
                                double maxHeight) {
  const int page = static_cast<int>(pageNumber);
  const int width = static_cast<int>(maxWidth);
  const int height = static_cast<int>(maxHeight);

  return runOnExecutor<std::shared_ptr<HybridRenderedPageSpec>>(
      _executor,
      [page, width, height](
          engine::MuPDFDocument& doc) -> std::shared_ptr<HybridRenderedPageSpec> {
        const engine::Location location = doc.locationFromPageNumber(page);
        // Rasterised twice today, once per output form. That is a real cost
        // and the reason RenderedPage exists is to make it worth measuring
        // before optimising: the encode is the expensive half, and callers
        // that only want raw pixels should not pay for a PNG.
        engine::EncodedPage encoded = doc.renderEncoded(location, width, height);
        engine::RawPage raw = doc.renderRaw(location, width, height);
        return std::make_shared<HybridRenderedPage>(std::move(encoded),
                                                    std::move(raw));
      });
}

std::shared_ptr<Promise<std::vector<OutlineEntry>>>
HybridMuPDFDocument::getOutline() {
  return runOnExecutor<std::vector<OutlineEntry>>(
      _executor, [](engine::MuPDFDocument& doc) {
        std::vector<OutlineEntry> out;
        for (const engine::OutlineItem& item : doc.outline()) {
          OutlineEntry entry;
          entry.title = item.title;
          entry.depth = static_cast<double>(item.depth);
          entry.uri = item.uri;
          if (item.location.has_value()) {
            entry.chapter = static_cast<double>(item.location->chapter);
            entry.page = static_cast<double>(item.location->page);
            entry.pageNumber =
                static_cast<double>(doc.pageNumberFromLocation(*item.location));
          } else {
            entry.chapter = -1.0;
            entry.page = -1.0;
            entry.pageNumber = -1.0;
          }
          out.push_back(std::move(entry));
        }
        return out;
      });
}

std::shared_ptr<Promise<std::vector<SearchResult>>> HybridMuPDFDocument::search(
    const std::string& needle, double maxHits) {
  const int limit = static_cast<int>(maxHits);
  // Captured before the job runs so the search can be abandoned by a close
  // that arrives while it is scanning.
  auto token = _executor ? _executor->cancellationToken() : std::function<bool()>{};

  return runOnExecutor<std::vector<SearchResult>>(
      _executor, [needle, limit, token](engine::MuPDFDocument& doc) {
        std::vector<SearchResult> out;
        for (const engine::SearchHit& hit : doc.search(needle, limit, token)) {
          SearchResult result;
          result.chapter = static_cast<double>(hit.location.chapter);
          result.page = static_cast<double>(hit.location.page);
          result.pageNumber =
              static_cast<double>(doc.pageNumberFromLocation(hit.location));
          result.x0 = static_cast<double>(hit.x0);
          result.y0 = static_cast<double>(hit.y0);
          result.x1 = static_cast<double>(hit.x1);
          result.y1 = static_cast<double>(hit.y1);
          out.push_back(result);
        }
        return out;
      });
}

std::shared_ptr<Promise<std::string>> HybridMuPDFDocument::getPageText(
    double pageNumber) {
  const int page = static_cast<int>(pageNumber);
  return runOnExecutor<std::string>(_executor, [page](engine::MuPDFDocument& doc) {
    return doc.pageText(doc.locationFromPageNumber(page));
  });
}

std::shared_ptr<Promise<bool>> HybridMuPDFDocument::authenticate(
    const std::string& password) {
  return runOnExecutor<bool>(_executor, [password](engine::MuPDFDocument& doc) {
    return doc.authenticate(password);
  });
}

void HybridMuPDFDocument::close() {
  if (!_executor) {
    return;  // idempotent
  }
  // Drops our reference after draining. Any job still holding the executor
  // keeps it alive until it finishes; nothing new will start.
  auto executor = std::move(_executor);
  executor->shutdown();
}

}  // namespace margelo::nitro::nitroflipper
