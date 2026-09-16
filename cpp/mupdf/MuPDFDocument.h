#pragma once

// The shared C++ document engine. One instance owns one open document.
//
// Threading (per MuPDF's documented model): a fz_context is cheap but a
// fz_document is not safe for simultaneous access, and cloning a context does
// not make it so. Every method here therefore assumes the caller has
// serialized access -- DocumentExecutor is what provides that. The engine does
// not lock internally, because a lock that only makes individual calls atomic
// would still let a render observe a half-applied relayout.
//
// Generations are how stale work is dropped. Opening or closing bumps
// docGeneration; laying out bumps layoutGeneration. A result carries the pair
// it was produced under, and the caller discards anything that no longer
// matches. Without that, a render that started before a font-size change
// arrives afterwards and paints the old pagination.

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "FzGuard.h"
#include "FzHandles.h"

namespace nitroflipper::mupdf {

/** Where a page sits in a chapter-structured document. */
struct Location {
  int chapter = 0;
  int page = 0;

  friend bool operator==(const Location& a, const Location& b) noexcept {
    return a.chapter == b.chapter && a.page == b.page;
  }
  friend bool operator!=(const Location& a, const Location& b) noexcept {
    return !(a == b);
  }
};

/** Page size in points, before any device scale. */
struct PageBox {
  float width = 0.0f;
  float height = 0.0f;
};

struct Generations {
  std::uint64_t document = 0;
  std::uint64_t layout = 0;

  friend bool operator==(const Generations& a, const Generations& b) noexcept {
    return a.document == b.document && a.layout == b.layout;
  }
};

/** An immutable view of the document, published after each async operation. */
struct Snapshot {
  Generations generations;
  int pageCount = 0;
  bool reflowable = false;
  bool needsPassword = false;
  std::string format;
};

struct OutlineItem {
  std::string title;
  /** Empty when the entry has no resolvable destination. */
  std::optional<Location> location;
  int depth = 0;
  std::string uri;
};

struct SearchHit {
  Location location;
  /** Quad in page coordinates, as four corners: ul, ur, ll, lr. */
  float x0 = 0, y0 = 0, x1 = 0, y1 = 0;
};

/** A rendered page, already encoded, ready for Skia. */
struct EncodedPage {
  std::vector<std::uint8_t> bytes;
  int width = 0;
  int height = 0;
  Generations generations;
};

/** A rendered page as raw pixels, for the zero-decode path. */
struct RawPage {
  std::vector<std::uint8_t> pixels;
  int width = 0;
  int height = 0;
  int stride = 0;
  /** Always 4 (RGBA8888) today; explicit so the JS side never guesses. */
  int components = 4;
  bool premultiplied = false;
  Generations generations;
};

struct StyleOptions {
  bool usePublisherStyles = true;
  std::string userCss;
};

struct LayoutOptions {
  /** Single-column width in points. For a spread this is one leaf, not both. */
  float width = 0.0f;
  float height = 0.0f;
  float fontSizePt = 12.0f;
};

/**
 * One open document.
 *
 * Construction does no parsing; call open(). Destruction is only safe once no
 * operation is in flight, which DocumentExecutor guarantees by draining its
 * queue before releasing its engine reference.
 */
class MuPDFDocument {
 public:
  /**
   * @param storeBudgetBytes fitz's own resource cache ceiling. This is separate
   *        from the renderer's texture budget and from any decoded-image cache;
   *        all three are counted in docs/adr/0003-cache-identity-and-budget.md.
   */
  explicit MuPDFDocument(std::size_t storeBudgetBytes = kDefaultStoreBudget);
  ~MuPDFDocument();

  MuPDFDocument(const MuPDFDocument&) = delete;
  MuPDFDocument& operator=(const MuPDFDocument&) = delete;

  static constexpr std::size_t kDefaultStoreBudget = 48u * 1024u * 1024u;

  /**
   * Parse the document at `path`.
   *
   * Throws Error{PasswordRequired} when the file is encrypted and no password
   * was given; the caller may then call authenticate() and retry.
   */
  void open(const std::string& path, const std::string& password = {});

  /** Supply a password for a document that reported PasswordRequired. */
  bool authenticate(const std::string& password);

  /**
   * Release the document and bump the document generation.
   *
   * Safe to call repeatedly. After this, every previously issued result is
   * stale by generation and every accessor reports an empty document.
   */
  void close() noexcept;

  bool isOpen() const noexcept { return static_cast<bool>(doc_); }
  Snapshot snapshot() const;
  Generations generations() const noexcept { return generations_; }

  /** True for EPUB and the other HTML-derived formats. */
  bool isReflowable() const;

  /**
   * Apply publisher-style and user-CSS choices to this document only.
   *
   * Uses fz_style_document, added in 1.28.0. The context-global
   * fz_set_user_css / fz_set_use_document_css are deprecated (MuPDF CHANGES,
   * 1.28.0) and would leak one reader's appearance settings into another
   * reader open in the same process.
   *
   * Must be followed by layout() to take effect.
   */
  void style(const StyleOptions& options);

  /**
   * Lay the document out at the given single-column size, bumping the layout
   * generation. A no-op for non-reflowable documents.
   */
  void layout(const LayoutOptions& options);

  int pageCount() const;
  PageBox pageBox(const Location& location) const;

  /** Chapter-aware navigation. */
  Location locationFromPageNumber(int pageNumber) const;
  int pageNumberFromLocation(const Location& location) const;
  Location nextPage(const Location& from) const;
  Location previousPage(const Location& from) const;

  /**
   * A relayout-stable anchor for `location`.
   *
   * fz_make_bookmark resolves to the same place after a layout with different
   * parameters, which is what preserves the reading position across a
   * font-size change. The value is only meaningful to this open document --
   * see locatorFor() for the persistable form.
   */
  fz_bookmark makeBookmark(const Location& location) const;
  Location resolveBookmark(fz_bookmark mark) const;

  /**
   * A persistable, versioned locator.
   *
   * Format is documented in docs/adr/0004-locator-format.md. It carries a
   * chapter/resource anchor so it survives repagination; a bare page index or
   * percentage does not. This is deliberately NOT an EPUB CFI and must not be
   * described as one.
   */
  std::string locatorFor(const Location& location) const;
  std::optional<Location> locationFromLocator(const std::string& locator) const;

  std::vector<OutlineItem> outline() const;

  /**
   * Search the whole document.
   *
   * `shouldContinue` is polled between chapters so a close or a superseding
   * search can abandon the scan without waiting for it to finish.
   */
  std::vector<SearchHit> search(const std::string& needle, int maxHits,
                                const std::function<bool()>& shouldContinue) const;

  /** Plain text of one page, for selection and screen readers. */
  std::string pageText(const Location& location) const;

  /**
   * Render one page to fit inside maxWidth x maxHeight device pixels,
   * preserving aspect, and encode it losslessly as PNG.
   *
   * Lossless because these bytes feed a page-curl that samples the image at
   * arbitrary scales; JPEG ringing on text is visible under the fold.
   */
  EncodedPage renderEncoded(const Location& location, int maxWidth, int maxHeight) const;

  /** Same render, handed back as raw RGBA without an encode/decode round trip. */
  RawPage renderRaw(const Location& location, int maxWidth, int maxHeight) const;

 private:
  /** Throws if no document is open, so every public accessor fails cleanly. */
  void requireOpen() const;

  /** Shared body of renderEncoded/renderRaw: returns a pixmap sized to fit. */
  PixmapHandle renderPixmap(const Location& location, int maxWidth, int maxHeight,
                            int& outWidth, int& outHeight) const;

  // Declared first so it is destroyed last: every handle below needs a live
  // context in its destructor.
  ContextHandle ctx_;
  DocumentHandle doc_;

  Generations generations_;
  bool needsPassword_ = false;
  std::string path_;
  std::string format_;
  LayoutOptions lastLayout_;
};

}  // namespace nitroflipper::mupdf
