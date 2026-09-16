#include "MuPDFDocument.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace nitroflipper::mupdf {
namespace {

/**
 * Largest page raster we will attempt, in pixels.
 *
 * A malformed or hostile document can declare an enormous MediaBox; without a
 * ceiling the pixmap allocation is attacker-controlled. 64 megapixels is far
 * past any phone viewport and still allocates predictably (256MB at RGBA).
 */
constexpr std::int64_t kMaxRenderPixels = 64ll * 1000ll * 1000ll;

/** Locator format version. Bump only with a migration in locationFromLocator. */
constexpr int kLocatorVersion = 1;

}  // namespace

MuPDFDocument::MuPDFDocument(std::size_t storeBudgetBytes) {
  // No custom allocator and no lock set: this engine serializes access, so the
  // context is only ever touched from one thread at a time. Passing a lock set
  // here would imply parallel use we do not support yet, and MuPDF is explicit
  // that supplying locks is what makes multi-threaded use legal.
  fz_context* raw = fz_new_context(nullptr, nullptr, storeBudgetBytes);
  if (raw == nullptr) {
    throw Error(ErrorKind::OutOfMemory, "fz_new_context failed");
  }
  ctx_ = ContextHandle(raw);

  // Registering handlers can throw, and it must happen before any open().
  fzCallVoid(ctx_.get(), [&] { fz_register_document_handlers(ctx_.get()); });
}

MuPDFDocument::~MuPDFDocument() {
  // Handles drop in reverse declaration order: doc_ then ctx_. Nothing here
  // may throw.
  doc_.reset();
  ctx_.reset();
}

void MuPDFDocument::requireOpen() const {
  if (!doc_) {
    throw Error(ErrorKind::Cancelled, "document is not open");
  }
}

void MuPDFDocument::open(const std::string& path, const std::string& password) {
  close();

  fz_context* ctx = ctx_.get();
  const char* cpath = path.c_str();

  // Adopt outside the guard: constructing the handle inside fz_try would put a
  // destructor in the longjmp path.
  fz_document* raw = fzCall(ctx, [&]() -> fz_document* {
    return fz_open_document(ctx, cpath);
  });
  DocumentHandle doc(ctx, raw);

  needsPassword_ = fzCall(ctx, [&]() -> int {
                     return fz_needs_password(ctx, doc.get());
                   }) != 0;

  if (needsPassword_) {
    if (password.empty()) {
      // Keep the document so authenticate() can retry without reparsing.
      doc_ = std::move(doc);
      path_ = path;
      ++generations_.document;
      throw Error(ErrorKind::PasswordRequired, "document is password protected");
    }
    const char* cpw = password.c_str();
    const int ok = fzCall(ctx, [&]() -> int {
      return fz_authenticate_password(ctx, doc.get(), cpw);
    });
    if (ok == 0) {
      throw Error(ErrorKind::WrongPassword, "password rejected");
    }
    needsPassword_ = false;
  }

  char formatBuf[128] = {0};
  fzTry(ctx, [&] {
    fz_lookup_metadata(ctx, doc.get(), FZ_META_FORMAT, formatBuf, sizeof(formatBuf));
  });

  doc_ = std::move(doc);
  path_ = path;
  format_ = formatBuf;
  ++generations_.document;
  generations_.layout = 0;
}

bool MuPDFDocument::authenticate(const std::string& password) {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const char* cpw = password.c_str();

  const int ok = fzCall(ctx, [&]() -> int {
    return fz_authenticate_password(ctx, doc, cpw);
  });
  if (ok != 0) {
    needsPassword_ = false;
    // Content only becomes readable now, so anything cached against the
    // previous generation was rendered from a locked document.
    ++generations_.document;
  }
  return ok != 0;
}

void MuPDFDocument::close() noexcept {
  if (doc_) {
    doc_.reset();
    ++generations_.document;
  }
  generations_.layout = 0;
  needsPassword_ = false;
  path_.clear();
  format_.clear();
  lastLayout_ = LayoutOptions{};
}

Snapshot MuPDFDocument::snapshot() const {
  Snapshot snap;
  snap.generations = generations_;
  snap.needsPassword = needsPassword_;
  snap.format = format_;
  if (!doc_ || needsPassword_) {
    // A locked document has no readable page count; reporting 0 keeps the UI
    // from rendering an empty reader behind the password prompt.
    return snap;
  }
  snap.pageCount = pageCount();
  snap.reflowable = isReflowable();
  return snap;
}

bool MuPDFDocument::isReflowable() const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  return fzCall(ctx, [&]() -> int { return fz_is_document_reflowable(ctx, doc); }) != 0;
}

void MuPDFDocument::style(const StyleOptions& options) {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const int publisher = options.usePublisherStyles ? 1 : 0;
  // Empty user CSS must be NULL, not "": fitz treats an empty stylesheet as a
  // stylesheet that overrides nothing but still re-parses.
  const char* css = options.userCss.empty() ? nullptr : options.userCss.c_str();

  fzCallVoid(ctx, [&] { fz_style_document(ctx, doc, publisher, css); });
}

void MuPDFDocument::layout(const LayoutOptions& options) {
  requireOpen();
  if (!isReflowable()) {
    return;
  }
  if (options.width <= 0.0f || options.height <= 0.0f || options.fontSizePt <= 0.0f) {
    throw Error(ErrorKind::Generic, "layout needs positive width, height and font size");
  }

  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const float w = options.width;
  const float h = options.height;
  const float em = options.fontSizePt;

  fzCallVoid(ctx, [&] { fz_layout_document(ctx, doc, w, h, em); });

  lastLayout_ = options;
  ++generations_.layout;
}

int MuPDFDocument::pageCount() const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  return fzCall(ctx, [&]() -> int { return fz_count_pages(ctx, doc); });
}

PageBox MuPDFDocument::pageBox(const Location& location) const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const int ch = location.chapter;
  const int pg = location.page;

  fz_page* raw = fzCall(ctx, [&]() -> fz_page* {
    return fz_load_chapter_page(ctx, doc, ch, pg);
  });
  PageHandle page(ctx, raw);

  const fz_rect bounds = fzCall(ctx, [&]() -> fz_rect {
    return fz_bound_page(ctx, page.get());
  });
  return PageBox{bounds.x1 - bounds.x0, bounds.y1 - bounds.y0};
}

Location MuPDFDocument::locationFromPageNumber(int pageNumber) const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const fz_location loc = fzCall(ctx, [&]() -> fz_location {
    return fz_location_from_page_number(ctx, doc, pageNumber);
  });
  return Location{loc.chapter, loc.page};
}

int MuPDFDocument::pageNumberFromLocation(const Location& location) const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const fz_location loc{location.chapter, location.page};
  return fzCall(ctx, [&]() -> int {
    return fz_page_number_from_location(ctx, doc, loc);
  });
}

Location MuPDFDocument::nextPage(const Location& from) const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const fz_location loc{from.chapter, from.page};
  const fz_location next = fzCall(ctx, [&]() -> fz_location {
    return fz_next_page(ctx, doc, loc);
  });
  return Location{next.chapter, next.page};
}

Location MuPDFDocument::previousPage(const Location& from) const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const fz_location loc{from.chapter, from.page};
  const fz_location prev = fzCall(ctx, [&]() -> fz_location {
    return fz_previous_page(ctx, doc, loc);
  });
  return Location{prev.chapter, prev.page};
}

fz_bookmark MuPDFDocument::makeBookmark(const Location& location) const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const fz_location loc{location.chapter, location.page};
  return fzCall(ctx, [&]() -> fz_bookmark {
    return fz_make_bookmark(ctx, doc, loc);
  });
}

Location MuPDFDocument::resolveBookmark(fz_bookmark mark) const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const fz_location loc = fzCall(ctx, [&]() -> fz_location {
    return fz_lookup_bookmark(ctx, doc, mark);
  });
  return Location{loc.chapter, loc.page};
}

std::string MuPDFDocument::locatorFor(const Location& location) const {
  requireOpen();
  // v1: version, chapter, page-within-chapter, and the flat page number as a
  // fallback for documents whose chapter structure changes between versions.
  // The chapter anchor is what survives repagination; the flat index is only
  // consulted when the chapter no longer exists.
  const int flat = pageNumberFromLocation(location);
  char buf[96];
  std::snprintf(buf, sizeof(buf), "nfl:%d:%d:%d:%d", kLocatorVersion,
                location.chapter, location.page, flat);
  return std::string(buf);
}

std::optional<Location> MuPDFDocument::locationFromLocator(
    const std::string& locator) const {
  requireOpen();
  int version = 0, chapter = 0, page = 0, flat = 0;
  if (std::sscanf(locator.c_str(), "nfl:%d:%d:%d:%d", &version, &chapter, &page,
                  &flat) != 4) {
    return std::nullopt;
  }
  if (version != kLocatorVersion) {
    return std::nullopt;
  }

  // Trust the chapter anchor when it still resolves. fz_page_number_from_location
  // returns -1 for a location the current layout does not contain, which is
  // exactly the "chapter went away" case the flat index covers.
  const Location anchored{chapter, page};
  const int resolved = pageNumberFromLocation(anchored);
  if (resolved >= 0) {
    return anchored;
  }

  const int count = pageCount();
  if (count <= 0) {
    return std::nullopt;
  }
  return locationFromPageNumber(std::clamp(flat, 0, count - 1));
}

std::vector<OutlineItem> MuPDFDocument::outline() const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();

  fz_outline* raw = nullptr;
  // An absent outline is not an error; many documents have none.
  if (!fzTry(ctx, [&] { raw = fz_load_outline(ctx, doc); }) || raw == nullptr) {
    return {};
  }
  OutlineHandle root(ctx, raw);

  std::vector<OutlineItem> items;
  // Iterative walk with an explicit stack: an outline is attacker-controlled
  // and a recursive walk on a deep or cyclic one overflows the stack.
  struct Frame {
    fz_outline* node;
    int depth;
  };
  std::vector<Frame> stack;
  stack.push_back({root.get(), 0});

  constexpr std::size_t kMaxOutlineItems = 20000;
  while (!stack.empty() && items.size() < kMaxOutlineItems) {
    Frame frame = stack.back();
    stack.pop_back();
    for (fz_outline* node = frame.node; node != nullptr; node = node->next) {
      OutlineItem item;
      item.title = node->title != nullptr ? node->title : "";
      item.uri = node->uri != nullptr ? node->uri : "";
      item.depth = frame.depth;
      if (node->page.chapter >= 0 && node->page.page >= 0) {
        item.location = Location{node->page.chapter, node->page.page};
      }
      items.push_back(std::move(item));
      if (node->down != nullptr) {
        stack.push_back({node->down, frame.depth + 1});
      }
    }
  }
  return items;
}

std::string MuPDFDocument::pageText(const Location& location) const {
  requireOpen();
  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const int ch = location.chapter;
  const int pg = location.page;

  fz_page* rawPage = fzCall(ctx, [&]() -> fz_page* {
    return fz_load_chapter_page(ctx, doc, ch, pg);
  });
  PageHandle page(ctx, rawPage);

  fz_stext_options options = {};
  fz_stext_page* rawText = fzCall(ctx, [&]() -> fz_stext_page* {
    return fz_new_stext_page_from_page(ctx, page.get(), &options);
  });
  StextHandle text(ctx, rawText);

  fz_buffer* rawBuf = fzCall(ctx, [&]() -> fz_buffer* {
    return fz_new_buffer_from_stext_page(ctx, text.get());
  });
  BufferHandle buffer(ctx, rawBuf);

  unsigned char* data = nullptr;
  const std::size_t len = fzCall(ctx, [&]() -> std::size_t {
    return fz_buffer_storage(ctx, buffer.get(), &data);
  });
  return std::string(reinterpret_cast<const char*>(data), len);
}

std::vector<SearchHit> MuPDFDocument::search(
    const std::string& needle, int maxHits,
    const std::function<bool()>& shouldContinue) const {
  requireOpen();
  if (needle.empty() || maxHits <= 0) {
    return {};
  }

  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const char* cneedle = needle.c_str();

  std::vector<SearchHit> hits;
  const int pages = pageCount();

  for (int pageNumber = 0; pageNumber < pages; ++pageNumber) {
    // Polled per page, not per chapter: a chapter of a long EPUB can be
    // hundreds of pages, and a close should not wait for it.
    if (shouldContinue && !shouldContinue()) {
      throw Error(ErrorKind::Cancelled, "search abandoned");
    }

    const Location location = locationFromPageNumber(pageNumber);
    const int ch = location.chapter;
    const int pg = location.page;

    // Bounded per page so one pathological page cannot exhaust memory.
    constexpr int kMaxHitsPerPage = 64;
    fz_quad quads[kMaxHitsPerPage];
    int found = 0;
    const bool ok = fzTry(ctx, [&] {
      found = fz_search_chapter_page_number(ctx, doc, ch, pg, cneedle, nullptr,
                                            quads, kMaxHitsPerPage);
    });
    if (!ok) {
      continue;  // a page that will not parse should not abort the whole search
    }

    for (int i = 0; i < found && static_cast<int>(hits.size()) < maxHits; ++i) {
      const fz_rect r = fz_rect_from_quad(quads[i]);
      hits.push_back(SearchHit{location, r.x0, r.y0, r.x1, r.y1});
    }
    if (static_cast<int>(hits.size()) >= maxHits) {
      break;
    }
  }
  return hits;
}

PixmapHandle MuPDFDocument::renderPixmap(const Location& location, int maxWidth,
                                         int maxHeight, int& outWidth,
                                         int& outHeight) const {
  requireOpen();
  if (maxWidth <= 0 || maxHeight <= 0) {
    throw Error(ErrorKind::Generic, "render needs a positive target box");
  }

  fz_context* ctx = ctx_.get();
  fz_document* doc = doc_.get();
  const int ch = location.chapter;
  const int pg = location.page;

  fz_page* rawPage = fzCall(ctx, [&]() -> fz_page* {
    return fz_load_chapter_page(ctx, doc, ch, pg);
  });
  PageHandle page(ctx, rawPage);

  const fz_rect bounds = fzCall(ctx, [&]() -> fz_rect {
    return fz_bound_page(ctx, page.get());
  });
  const float pageW = bounds.x1 - bounds.x0;
  const float pageH = bounds.y1 - bounds.y0;
  if (pageW <= 0.0f || pageH <= 0.0f) {
    throw Error(ErrorKind::Malformed, "page has no area");
  }

  // Logical page points and output device pixels are different units; the scale
  // is the only place they meet.
  const float scale = std::min(static_cast<float>(maxWidth) / pageW,
                               static_cast<float>(maxHeight) / pageH);
  const int targetW = std::max(1, static_cast<int>(std::floor(pageW * scale)));
  const int targetH = std::max(1, static_cast<int>(std::floor(pageH * scale)));

  if (static_cast<std::int64_t>(targetW) * targetH > kMaxRenderPixels) {
    throw Error(ErrorKind::OutOfMemory, "requested raster exceeds the pixel ceiling");
  }

  const fz_matrix transform = fz_scale(scale, scale);
  fz_pixmap* rawPixmap = fzCall(ctx, [&]() -> fz_pixmap* {
    // Alpha off: a page is opaque, and an alpha channel costs 25% more memory
    // per texture for nothing.
    return fz_new_pixmap_from_page(ctx, page.get(), transform,
                                   fz_device_rgb(ctx), 0);
  });
  PixmapHandle pixmap(ctx, rawPixmap);

  outWidth = fz_pixmap_width(ctx, pixmap.get());
  outHeight = fz_pixmap_height(ctx, pixmap.get());
  return pixmap;
}

EncodedPage MuPDFDocument::renderEncoded(const Location& location, int maxWidth,
                                         int maxHeight) const {
  int width = 0;
  int height = 0;
  PixmapHandle pixmap = renderPixmap(location, maxWidth, maxHeight, width, height);

  fz_context* ctx = ctx_.get();
  fz_buffer* rawBuf = fzCall(ctx, [&]() -> fz_buffer* {
    return fz_new_buffer_from_pixmap_as_png(ctx, pixmap.get(), fz_default_color_params);
  });
  BufferHandle buffer(ctx, rawBuf);

  unsigned char* data = nullptr;
  const std::size_t len = fzCall(ctx, [&]() -> std::size_t {
    return fz_buffer_storage(ctx, buffer.get(), &data);
  });

  EncodedPage out;
  out.bytes.assign(data, data + len);
  out.width = width;
  out.height = height;
  out.generations = generations_;
  return out;
}

RawPage MuPDFDocument::renderRaw(const Location& location, int maxWidth,
                                 int maxHeight) const {
  int width = 0;
  int height = 0;
  PixmapHandle pixmap = renderPixmap(location, maxWidth, maxHeight, width, height);

  fz_context* ctx = ctx_.get();
  const int stride = fz_pixmap_stride(ctx, pixmap.get());
  const int components = fz_pixmap_components(ctx, pixmap.get());
  unsigned char* samples = fz_pixmap_samples(ctx, pixmap.get());

  RawPage out;
  out.width = width;
  out.height = height;
  out.stride = stride;
  out.components = components;
  // Rendered with alpha=0 above, so there is nothing premultiplied about it.
  out.premultiplied = false;
  out.generations = generations_;
  out.pixels.assign(samples, samples + static_cast<std::size_t>(stride) * height);
  return out;
}

}  // namespace nitroflipper::mupdf
