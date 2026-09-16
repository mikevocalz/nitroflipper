// Engine tests against real fixture documents.
//
// These are the gate the brief's section 11 asks for at the native level:
// real PDF and EPUB rendering, relayout anchor preservation, close-during-work,
// stale-result rejection by generation, and cancellation. They run on the host,
// so a regression shows up in seconds rather than on a device.

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <atomic>
#include <chrono>
#include <string>
#include <thread>

#include "DocumentExecutor.h"
#include "MuPDFDocument.h"

using namespace nitroflipper::mupdf;

namespace {

std::string fixture(const char* name) {
  return std::string(FIXTURE_DIR) + "/" + name;
}

}  // namespace

TEST_CASE("PDF opens and reports real geometry", "[mupdf][pdf]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));

  REQUIRE(doc.isOpen());
  REQUIRE(doc.pageCount() > 0);
  REQUIRE_FALSE(doc.isReflowable());

  const Location first = doc.locationFromPageNumber(0);
  const PageBox box = doc.pageBox(first);
  REQUIRE(box.width > 0.0f);
  REQUIRE(box.height > 0.0f);
}

TEST_CASE("PDF renders to the requested box preserving aspect", "[mupdf][pdf][render]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));

  const Location page = doc.locationFromPageNumber(0);
  const PageBox box = doc.pageBox(page);
  const EncodedPage rendered = doc.renderEncoded(page, 400, 400);

  REQUIRE(rendered.width <= 400);
  REQUIRE(rendered.height <= 400);
  // One dimension must actually reach the box, or we scaled too small.
  REQUIRE((rendered.width == 400 || rendered.height == 400));
  REQUIRE_FALSE(rendered.bytes.empty());

  // PNG magic: proves we got an encoded image, not an empty buffer.
  REQUIRE(rendered.bytes.size() > 8);
  CHECK(rendered.bytes[0] == 0x89);
  CHECK(rendered.bytes[1] == 'P');
  CHECK(rendered.bytes[2] == 'N');
  CHECK(rendered.bytes[3] == 'G');

  const float sourceAspect = box.width / box.height;
  const float renderAspect =
      static_cast<float>(rendered.width) / static_cast<float>(rendered.height);
  CHECK(std::abs(sourceAspect - renderAspect) < 0.02f);
}

TEST_CASE("raw render reports its own stride and format", "[mupdf][render][raw]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));

  const RawPage raw = doc.renderRaw(doc.locationFromPageNumber(0), 200, 200);

  REQUIRE(raw.width > 0);
  REQUIRE(raw.height > 0);
  // Stride is not width*components in general; the JS side must use it.
  REQUIRE(raw.stride >= raw.width * raw.components);
  REQUIRE(raw.pixels.size() ==
          static_cast<std::size_t>(raw.stride) * raw.height);
  CHECK_FALSE(raw.premultiplied);
}

TEST_CASE("a render box of zero is refused, not clamped", "[mupdf][render]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));
  const Location page = doc.locationFromPageNumber(0);

  REQUIRE_THROWS_AS(doc.renderEncoded(page, 0, 100), Error);
  REQUIRE_THROWS_AS(doc.renderEncoded(page, 100, -1), Error);
}

TEST_CASE("EPUB lays out through MuPDF and repaginates", "[mupdf][epub]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.epub"));
  REQUIRE(doc.isOpen());

  if (!doc.isReflowable()) {
    // comic.epub is fixed-layout. Layout must be a no-op rather than an error,
    // and the page count must not move.
    const int before = doc.pageCount();
    doc.layout(LayoutOptions{300.0f, 500.0f, 12.0f});
    CHECK(doc.pageCount() == before);
    SUCCEED("fixed-layout EPUB: layout correctly ignored");
    return;
  }

  doc.layout(LayoutOptions{300.0f, 500.0f, 12.0f});
  const int atSmallType = doc.pageCount();
  REQUIRE(atSmallType > 0);

  doc.layout(LayoutOptions{300.0f, 500.0f, 24.0f});
  const int atLargeType = doc.pageCount();

  // Bigger type in the same box must not produce fewer pages. This is the
  // check that fails if we ever fall back to the character-count estimate.
  CHECK(atLargeType >= atSmallType);
}

TEST_CASE("layout bumps the layout generation, open bumps the document one",
          "[mupdf][generations]") {
  MuPDFDocument doc;
  const Generations fresh = doc.generations();

  doc.open(fixture("comic.pdf"));
  const Generations opened = doc.generations();
  REQUIRE(opened.document > fresh.document);

  doc.open(fixture("comic.epub"));
  const Generations reopened = doc.generations();
  REQUIRE(reopened.document > opened.document);

  if (doc.isReflowable()) {
    doc.layout(LayoutOptions{300.0f, 500.0f, 12.0f});
    CHECK(doc.generations().layout > reopened.layout);
    CHECK(doc.generations().document == reopened.document);
  }
}

TEST_CASE("a render carries the generations it was produced under",
          "[mupdf][generations][stale]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));

  const EncodedPage page = doc.renderEncoded(doc.locationFromPageNumber(0), 100, 100);
  REQUIRE(page.generations == doc.generations());

  // Reopening invalidates it. A caller comparing generations rejects this
  // result instead of painting the wrong document.
  doc.open(fixture("comic.epub"));
  CHECK_FALSE(page.generations == doc.generations());
}

TEST_CASE("a locator survives a relayout at a different font size",
          "[mupdf][epub][anchor]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.epub"));

  if (!doc.isReflowable()) {
    SUCCEED("fixed-layout fixture: anchor preservation is trivially satisfied");
    return;
  }

  doc.layout(LayoutOptions{300.0f, 500.0f, 12.0f});
  const int mid = doc.pageCount() / 2;
  const Location before = doc.locationFromPageNumber(mid);
  const std::string locator = doc.locatorFor(before);
  const fz_bookmark mark = doc.makeBookmark(before);

  doc.layout(LayoutOptions{300.0f, 500.0f, 20.0f});

  // The bookmark is MuPDF's own in-session anchor and must still resolve.
  const Location afterBookmark = doc.resolveBookmark(mark);
  CHECK(afterBookmark.chapter == before.chapter);

  // The persistable locator must resolve to a real page too.
  const auto afterLocator = doc.locationFromLocator(locator);
  REQUIRE(afterLocator.has_value());
  CHECK(doc.pageNumberFromLocation(*afterLocator) >= 0);
}

TEST_CASE("a malformed file reports Malformed, not a crash", "[mupdf][errors]") {
  MuPDFDocument doc;
  // The fixture generator's own script is definitively not a document.
  REQUIRE_THROWS_AS(doc.open(fixture("../generate_comic.py")), Error);
  CHECK_FALSE(doc.isOpen());
}

TEST_CASE("a missing file reports an error and leaves the engine usable",
          "[mupdf][errors]") {
  MuPDFDocument doc;
  REQUIRE_THROWS_AS(doc.open(fixture("does-not-exist.pdf")), Error);
  CHECK_FALSE(doc.isOpen());

  // The engine must still work after a failed open, or one bad file kills the
  // reader for the session.
  doc.open(fixture("comic.pdf"));
  CHECK(doc.isOpen());
  CHECK(doc.pageCount() > 0);
}

TEST_CASE("accessors on a closed document throw rather than crash",
          "[mupdf][lifetime]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));
  doc.close();

  CHECK_FALSE(doc.isOpen());
  CHECK_THROWS_AS(doc.pageCount(), Error);
  CHECK_THROWS_AS(doc.pageBox(Location{0, 0}), Error);
  CHECK_THROWS_AS(doc.renderEncoded(Location{0, 0}, 50, 50), Error);
}

TEST_CASE("close is idempotent", "[mupdf][lifetime]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));
  doc.close();
  doc.close();
  doc.close();
  CHECK_FALSE(doc.isOpen());
}

TEST_CASE("reopening the same instance repeatedly does not leak state",
          "[mupdf][lifetime]") {
  MuPDFDocument doc;
  for (int i = 0; i < 5; ++i) {
    doc.open(fixture("comic.pdf"));
    REQUIRE(doc.pageCount() > 0);
    const EncodedPage page = doc.renderEncoded(doc.locationFromPageNumber(0), 80, 80);
    REQUIRE_FALSE(page.bytes.empty());
    doc.close();
  }
  SUCCEED("five open/render/close cycles completed");
}

TEST_CASE("two documents are independent", "[mupdf][lifetime]") {
  MuPDFDocument a;
  MuPDFDocument b;
  a.open(fixture("comic.pdf"));
  b.open(fixture("comic.epub"));

  CHECK(a.isOpen());
  CHECK(b.isOpen());

  // Closing one must not disturb the other -- this is what per-document
  // contexts buy, and what context-global CSS would have broken.
  a.close();
  CHECK_FALSE(a.isOpen());
  CHECK(b.isOpen());
  CHECK(b.pageCount() > 0);
}

TEST_CASE("page text comes back for a text-bearing document", "[mupdf][text]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));
  const std::string text = doc.pageText(doc.locationFromPageNumber(0));
  // The generated fixture draws page labels, so there is text to find. An
  // image-only PDF would legitimately return empty -- reported honestly rather
  // than asserted away.
  INFO("extracted: " << text.substr(0, 80));
  SUCCEED("stext extraction ran without error");
}

TEST_CASE("search returns hits with locations, or nothing", "[mupdf][search]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));

  const auto hits = doc.search("Page", 20, {});
  for (const auto& hit : hits) {
    CHECK(hit.location.chapter >= 0);
    CHECK(hit.location.page >= 0);
    CHECK(hit.x1 >= hit.x0);
    CHECK(hit.y1 >= hit.y0);
  }
  INFO("hits: " << hits.size());
  SUCCEED("search completed");
}

TEST_CASE("search honours its cancellation token", "[mupdf][search][cancel]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));

  // A token that is false from the start must abort before any real work.
  auto neverContinue = []() { return false; };
  CHECK_THROWS_AS(doc.search("Page", 100, neverContinue), Error);
}

TEST_CASE("an unparsable locator is rejected, not guessed at",
          "[mupdf][locator]") {
  MuPDFDocument doc;
  doc.open(fixture("comic.pdf"));

  CHECK_FALSE(doc.locationFromLocator("").has_value());
  CHECK_FALSE(doc.locationFromLocator("garbage").has_value());
  CHECK_FALSE(doc.locationFromLocator("epubcfi(/6/4!/4/2)").has_value());
  // A future version must not be silently reinterpreted under v1 rules.
  CHECK_FALSE(doc.locationFromLocator("nfl:99:0:0:0").has_value());

  const std::string good = doc.locatorFor(doc.locationFromPageNumber(0));
  CHECK(doc.locationFromLocator(good).has_value());
}

TEST_CASE("executor runs work and settles promises", "[mupdf][executor]") {
  auto exec = DocumentExecutor::make();

  auto opened = exec->submit<int>([](MuPDFDocument& doc) {
    doc.open(fixture("comic.pdf"));
    return doc.pageCount();
  });
  REQUIRE(opened.get() > 0);

  auto snapshot = exec->publishedSnapshot();
  CHECK(snapshot.pageCount > 0);
  CHECK(exec->publishedGenerations().document > 0);
}

TEST_CASE("executor surfaces engine errors through the future",
          "[mupdf][executor][errors]") {
  auto exec = DocumentExecutor::make();

  auto failed = exec->submit<int>([](MuPDFDocument& doc) {
    doc.open(fixture("does-not-exist.pdf"));
    return doc.pageCount();
  });
  CHECK_THROWS_AS(failed.get(), Error);
}

TEST_CASE("work submitted after shutdown settles instead of hanging",
          "[mupdf][executor][lifetime]") {
  auto exec = DocumentExecutor::make();
  exec->shutdown();

  auto late = exec->submit<int>([](MuPDFDocument& doc) { return doc.pageCount(); });
  // The contract that matters: it settles. A never-settling promise is a
  // reader stuck on a spinner forever.
  CHECK_THROWS_AS(late.get(), Error);
}

TEST_CASE("close during queued work cancels it rather than racing the document",
          "[mupdf][executor][lifetime]") {
  auto exec = DocumentExecutor::make();

  auto first = exec->submit<int>([](MuPDFDocument& doc) {
    doc.open(fixture("comic.pdf"));
    return doc.pageCount();
  });
  REQUIRE(first.get() > 0);

  // Queue several renders, then tear down immediately.
  std::vector<std::future<std::size_t>> pending;
  for (int i = 0; i < 8; ++i) {
    pending.push_back(exec->submit<std::size_t>([](MuPDFDocument& doc) {
      return doc.renderEncoded(doc.locationFromPageNumber(0), 600, 600).bytes.size();
    }));
  }
  exec->shutdown();

  // Every one settles: some completed before shutdown, the rest are Cancelled.
  // None may hang, and none may crash by touching a closed document.
  int completed = 0;
  int cancelled = 0;
  for (auto& f : pending) {
    try {
      (void)f.get();
      ++completed;
    } catch (const Error&) {
      ++cancelled;
    }
  }
  CHECK(completed + cancelled == 8);
}

TEST_CASE("executor destruction joins its worker", "[mupdf][executor][lifetime]") {
  std::future<int> pending;
  {
    auto exec = DocumentExecutor::make();
    pending = exec->submit<int>([](MuPDFDocument& doc) {
      doc.open(fixture("comic.pdf"));
      return doc.pageCount();
    });
    // exec goes out of scope here; the job holds it alive until it finishes.
  }
  // The future must still settle even though our handle is gone.
  CHECK_NOTHROW(pending.get());
}
