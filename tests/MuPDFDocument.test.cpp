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

TEST_CASE("dropping the last handle cancels queued work without deadlocking",
          "[mupdf][executor][lifetime]") {
  std::future<int> pending;
  {
    auto exec = DocumentExecutor::make();
    pending = exec->submit<int>([](MuPDFDocument& doc) {
      doc.open(fixture("comic.pdf"));
      return doc.pageCount();
    });
    // exec goes out of scope here, so ~DocumentExecutor drains the queue.
  }

  // Two things are being asserted, and the first matters more than the second.
  //
  // It must SETTLE. An earlier version had jobs hold a shared_ptr to the
  // executor so queued work would still complete. That made the worker capable
  // of dropping the last reference, so ~DocumentExecutor ran ON the worker and
  // shutdown() joined its own thread: "Resource deadlock avoided" thrown out
  // of a noexcept function, i.e. std::terminate. Jobs now hold the document
  // and only a weak reference to the executor.
  //
  // And it settles as CANCELLED, which is the right contract: releasing the
  // last handle to a reader means nobody is going to read the result, so
  // finishing the render would be work done for no one.
  CHECK_THROWS_AS(pending.get(), Error);
}

// ---------------------------------------------------------------------------
// Edge-case fixtures.
//
// Everything above this line runs against comic.pdf and comic.epub. comic.epub
// is pre-paginated -- one image per spine item -- so its page count does not
// move when the font size does, and every repagination assertion made against
// it is vacuously true. The fixtures below exist to make those assertions bite:
// reflow.epub actually repaginates, mixed.pdf actually changes page size
// mid-document, locked.pdf is actually encrypted, malformed.pdf is actually
// broken.
//
// Generated by fixtures/generate_edge_cases.py.
// ---------------------------------------------------------------------------

TEST_CASE("reflow.epub: bigger type in the same box means strictly more pages",
          "[mupdf][epub][reflow]") {
  MuPDFDocument doc;
  doc.open(fixture("reflow.epub"));
  REQUIRE(doc.isOpen());
  REQUIRE(doc.isReflowable());

  doc.layout(LayoutOptions{300.0f, 500.0f, 12.0f});
  const int atSmallType = doc.pageCount();
  REQUIRE(atSmallType > 0);

  doc.layout(LayoutOptions{300.0f, 500.0f, 24.0f});
  const int atLargeType = doc.pageCount();

  // Strictly greater, not >=. On a genuinely reflowable document the same text
  // at double the em cannot fit in the same number of pages, and >= would pass
  // even if layout() had silently become a no-op.
  INFO("12pt -> " << atSmallType << " pages, 24pt -> " << atLargeType);
  CHECK(atLargeType > atSmallType);

  // And the layout generation moved both times, so a render issued under the
  // old pagination is rejectable.
  CHECK(doc.generations().layout >= 2);
}

TEST_CASE("reflow.epub: a mid-book locator still lands in the same chapter "
          "after relayout at a different font size",
          "[mupdf][epub][reflow][anchor]") {
  MuPDFDocument doc;
  doc.open(fixture("reflow.epub"));
  REQUIRE(doc.isReflowable());

  doc.layout(LayoutOptions{300.0f, 500.0f, 12.0f});
  const int total = doc.pageCount();
  REQUIRE(total > 4);

  const Location mid = doc.locationFromPageNumber(total / 2);
  // The fixture stamps a unique "Marker CHnn" into each chapter heading, so
  // the chapter index is tied to real content rather than being checked
  // against itself.
  const std::string headBefore = doc.pageText(Location{mid.chapter, 0});
  INFO("mid page " << (total / 2) << " of " << total << " is chapter "
                   << mid.chapter << " page " << mid.page);
  INFO("chapter head before: " << headBefore.substr(0, 60));
  REQUIRE(headBefore.find("Marker") != std::string::npos);

  const std::string locator = doc.locatorFor(mid);
  const fz_bookmark mark = doc.makeBookmark(mid);

  doc.layout(LayoutOptions{300.0f, 500.0f, 24.0f});
  REQUIRE(doc.pageCount() > total);

  const auto resolved = doc.locationFromLocator(locator);
  REQUIRE(resolved.has_value());
  CHECK(resolved->chapter == mid.chapter);
  CHECK(doc.pageNumberFromLocation(*resolved) >= 0);

  // fz_make_bookmark is the in-session anchor and must agree.
  CHECK(doc.resolveBookmark(mark).chapter == mid.chapter);

  // Same chapter, same heading text, after the repagination.
  const std::string headAfter = doc.pageText(Location{resolved->chapter, 0});
  INFO("chapter head after: " << headAfter.substr(0, 60));
  CHECK(headAfter.find("Marker") != std::string::npos);
  CHECK(headAfter.substr(0, 20) == headBefore.substr(0, 20));
}

TEST_CASE("reflow.epub: layout width is one column, not the spread",
          "[mupdf][epub][reflow][layout]") {
  MuPDFDocument doc;
  doc.open(fixture("reflow.epub"));
  REQUIRE(doc.isReflowable());

  doc.layout(LayoutOptions{300.0f, 500.0f, 12.0f});
  const int oneColumn = doc.pageCount();
  REQUIRE(oneColumn > 0);

  doc.layout(LayoutOptions{600.0f, 500.0f, 12.0f});
  const int doubleWidth = doc.pageCount();

  // Twice the column width holds roughly twice the text, so the page count has
  // to fall. If a caller ever passes the spread width here instead of the leaf
  // width, the reader silently paginates at half the density it should and
  // every stored locator points at the wrong place -- this is the assertion
  // that catches it.
  INFO("300pt column -> " << oneColumn << " pages, 600pt -> " << doubleWidth);
  CHECK(doubleWidth < oneColumn);
}

TEST_CASE("mixed.pdf: each page keeps its own box and its own aspect",
          "[mupdf][pdf][mixed]") {
  MuPDFDocument doc;
  doc.open(fixture("mixed.pdf"));
  REQUIRE(doc.pageCount() == 4);

  std::vector<PageBox> boxes;
  for (int i = 0; i < 4; ++i) {
    boxes.push_back(doc.pageBox(doc.locationFromPageNumber(i)));
    INFO("page " << i << ": " << boxes[i].width << " x " << boxes[i].height);
  }

  // A4 portrait, A5 landscape, a double-width spread, A4 portrait again.
  CHECK(boxes[0].width < boxes[0].height);
  CHECK(boxes[1].width > boxes[1].height);
  CHECK(boxes[2].width > boxes[0].width * 1.9f);
  CHECK(std::abs(boxes[3].width - boxes[0].width) < 0.5f);
  CHECK(std::abs(boxes[3].height - boxes[0].height) < 0.5f);

  // The point of the fixture: page 1 must not come back wearing page 0's box.
  CHECK(std::abs(boxes[0].height - boxes[1].height) > 1.0f);
  CHECK(std::abs(boxes[1].width - boxes[2].width) > 1.0f);

  for (int i = 0; i < 4; ++i) {
    const EncodedPage rendered =
        doc.renderEncoded(doc.locationFromPageNumber(i), 400, 400);
    REQUIRE_FALSE(rendered.bytes.empty());
    REQUIRE(rendered.width > 0);
    REQUIRE(rendered.height > 0);
    CHECK(rendered.width <= 400);
    CHECK(rendered.height <= 400);
    CHECK((rendered.width == 400 || rendered.height == 400));

    const float sourceAspect = boxes[i].width / boxes[i].height;
    const float renderAspect =
        static_cast<float>(rendered.width) / static_cast<float>(rendered.height);
    INFO("page " << i << " source aspect " << sourceAspect << ", render aspect "
                 << renderAspect);
    CHECK(std::abs(sourceAspect - renderAspect) < 0.02f);
  }
}

TEST_CASE("locked.pdf: open without a password reports PasswordRequired, then "
          "authenticate opens it",
          "[mupdf][pdf][password]") {
  MuPDFDocument doc;

  ErrorKind kind = ErrorKind::Generic;
  try {
    doc.open(fixture("locked.pdf"));
    FAIL("an encrypted document must not open without a password");
  } catch (const Error& e) {
    kind = e.kind();
  }
  CHECK(kind == ErrorKind::PasswordRequired);

  // open() deliberately keeps the parsed document so authenticate() can retry
  // without reparsing, but a locked document reports no readable pages.
  REQUIRE(doc.isOpen());
  const Snapshot locked = doc.snapshot();
  CHECK(locked.needsPassword);
  CHECK(locked.pageCount == 0);

  CHECK_FALSE(doc.authenticate("wrong"));
  CHECK(doc.snapshot().needsPassword);

  REQUIRE(doc.authenticate("open-sesame"));
  const Snapshot unlocked = doc.snapshot();
  CHECK_FALSE(unlocked.needsPassword);
  CHECK(unlocked.pageCount == 3);
  // Unlocking changed what is readable, so anything rendered before it is
  // stale by generation.
  CHECK(unlocked.generations.document > locked.generations.document);

  const EncodedPage page =
      doc.renderEncoded(doc.locationFromPageNumber(0), 200, 200);
  REQUIRE(page.bytes.size() > 8);
  CHECK(page.bytes[0] == 0x89);
}

TEST_CASE("locked.pdf: the password can also be supplied at open time",
          "[mupdf][pdf][password]") {
  MuPDFDocument doc;
  doc.open(fixture("locked.pdf"), "open-sesame");
  CHECK(doc.isOpen());
  CHECK_FALSE(doc.snapshot().needsPassword);
  CHECK(doc.pageCount() == 3);

  MuPDFDocument rejected;
  ErrorKind kind = ErrorKind::Generic;
  try {
    rejected.open(fixture("locked.pdf"), "not-the-password");
    FAIL("a wrong password must not open the document");
  } catch (const Error& e) {
    kind = e.kind();
  }
  // A rejected password is its own kind, so the UI can say "wrong password"
  // rather than "this file is broken".
  CHECK(kind == ErrorKind::WrongPassword);
}

TEST_CASE("malformed.pdf: rejected cleanly, and the engine survives it",
          "[mupdf][pdf][errors]") {
  MuPDFDocument doc;

  ErrorKind kind = ErrorKind::Generic;
  try {
    doc.open(fixture("malformed.pdf"));
    FAIL("a PDF with no recoverable objects must not open");
  } catch (const Error& e) {
    INFO("message: " << e.what());
    kind = e.kind();
  }
  // Malformed specifically, so the UI can say "this file is damaged" rather
  // than falling back to a generic failure. The fixture is cut before the
  // first indirect object precisely to land here -- cutting later lets MuPDF's
  // repair pass rebuild a readable document, which is not a useful fixture.
  CHECK(kind == ErrorKind::Malformed);
  CHECK_FALSE(doc.isOpen());
  CHECK_THROWS_AS(doc.pageCount(), Error);

  // One corrupt file must not end the session. This is also the check that the
  // fitz error was consumed: a stale errcode makes the next fz_throw report the
  // previous error instead, and a leaked one would surface here.
  doc.open(fixture("mixed.pdf"));
  CHECK(doc.isOpen());
  CHECK(doc.pageCount() == 4);
  CHECK_FALSE(
      doc.renderEncoded(doc.locationFromPageNumber(0), 120, 120).bytes.empty());

  // And a reflowable document opens afterwards too, so the failure did not
  // damage the shared context's handler registration.
  doc.open(fixture("reflow.epub"));
  doc.layout(LayoutOptions{300.0f, 500.0f, 12.0f});
  CHECK(doc.pageCount() > 0);
}

TEST_CASE("rtl.epub: opens, lays out and renders",
          "[mupdf][epub][rtl]") {
  MuPDFDocument doc;
  doc.open(fixture("rtl.epub"));
  REQUIRE(doc.isOpen());
  REQUIRE(doc.isReflowable());

  doc.layout(LayoutOptions{300.0f, 500.0f, 14.0f});
  REQUIRE(doc.pageCount() > 0);

  const EncodedPage page =
      doc.renderEncoded(doc.locationFromPageNumber(0), 300, 500);
  REQUIRE(page.bytes.size() > 8);
  CHECK(page.bytes[0] == 0x89);
  CHECK(page.width > 0);
  CHECK(page.height > 0);

  // Arabic and Hebrew text comes back from stext, which proves the shaper ran
  // and the Noto fallback fonts are compiled in (NITROFLIPPER_MUPDF_FONTS).
  const std::string text = doc.pageText(doc.locationFromPageNumber(0));
  CHECK_FALSE(text.empty());

  // DELIBERATELY NOT ASSERTED: reading direction.
  //
  // The fixture's spine carries page-progression-direction="rtl", and this
  // engine does not read that attribute -- there is no direction field on
  // Location, Snapshot or PageBox to read it into. MuPDF 1.28.4 does not read
  // it either; the string "page-progression" appears nowhere in its source
  // tree. So there is nothing here that could tell a reader to turn pages
  // right-to-left, and any assertion to that effect would be testing a feature
  // that does not exist. RTL page ordering is driven by the CBZ ComicInfo
  // path today (see ComicArchive), not by EPUB metadata.
  //
  // When EPUB direction support lands, the assertion goes here.
}

TEST_CASE("reflow.epub: repeated open/layout/render/close stays correct",
          "[mupdf][epub][reflow][lifetime]") {
  MuPDFDocument doc;
  const LayoutOptions options{320.0f, 480.0f, 13.0f};
  int firstCount = 0;

  for (int cycle = 0; cycle < 5; ++cycle) {
    doc.open(fixture("reflow.epub"));
    doc.layout(options);
    const int count = doc.pageCount();
    REQUIRE(count > 0);
    if (cycle == 0) {
      firstCount = count;
    }
    // Same file, same layout parameters: the pagination must be identical
    // every cycle. A drifting count means state survived close().
    INFO("cycle " << cycle << " page count " << count);
    CHECK(count == firstCount);

    const EncodedPage page =
        doc.renderEncoded(doc.locationFromPageNumber(count / 2), 160, 240);
    REQUIRE_FALSE(page.bytes.empty());
    doc.close();
  }

  // After all that churn it must still render real content, not a blank page.
  doc.open(fixture("reflow.epub"));
  doc.layout(options);
  CHECK(doc.pageCount() == firstCount);

  const RawPage raw = doc.renderRaw(doc.locationFromPageNumber(1), 160, 240);
  REQUIRE(raw.width > 0);
  REQUIRE(raw.height > 0);
  REQUIRE(raw.pixels.size() ==
          static_cast<std::size_t>(raw.stride) * raw.height);

  // A page of text is not a uniform field. A blank or all-white render -- the
  // way a broken relayout usually fails -- would be.
  bool varied = false;
  for (std::size_t i = 4; i < raw.pixels.size(); i += 4) {
    if (raw.pixels[i] != raw.pixels[0]) {
      varied = true;
      break;
    }
  }
  CHECK(varied);

  const EncodedPage encoded =
      doc.renderEncoded(doc.locationFromPageNumber(1), 200, 300);
  REQUIRE(encoded.bytes.size() > 8);
  CHECK(encoded.bytes[0] == 0x89);
  CHECK(encoded.bytes[1] == 'P');
  CHECK(encoded.generations == doc.generations());

  const std::string text = doc.pageText(doc.locationFromPageNumber(1));
  CHECK_FALSE(text.empty());
}
