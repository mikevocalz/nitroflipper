#include "ComicArchive.h"

#include <catch2/catch_test_macros.hpp>

#include <filesystem>

using namespace nitroflipper;

namespace {

std::filesystem::path fixturePath(const char* name) {
  // Tests run from the repo root, so fixtures live at fixtures/output/.
  return std::filesystem::current_path() / "fixtures" / "output" / name;
}

} // namespace

TEST_CASE("ComicArchive rejects a non-existent file", "[ComicArchive]") {
  ComicArchive archive;
  CHECK(archive.open("/tmp/does-not-exist.cbz") == false);
  CHECK(archive.isOpen() == false);
}

TEST_CASE("ComicArchive reads the LTR synthetic CBZ", "[ComicArchive]") {
  ComicArchive archive;
  REQUIRE(archive.open(fixturePath("ltr.cbz").string()));
  REQUIRE(archive.isOpen());

  // cover, page01, page02, spread, page03, page04
  CHECK(archive.pageCount() == 6);
  CHECK(archive.progressionDirection() == ProgressionDirection::Ltr);

  const auto& cover = archive.page(0);
  CHECK(cover.isCover);
  CHECK(cover.slot == SpreadSlot::Center);
  CHECK(cover.box.width == 400);
  CHECK(cover.box.height == 600);

  // Natural sort places the double-page spread last.
  const auto& spread = archive.page(archive.pageCount() - 1);
  CHECK(spread.doublePage);
  CHECK(spread.slot == SpreadSlot::Center);
  CHECK(spread.box.width == 800);
  CHECK(spread.box.height == 600);

  auto bytes = archive.readPageBytes(0);
  CHECK(!bytes.empty());
  // JPEG SOI
  CHECK(bytes[0] == 0xFF);
  CHECK(bytes[1] == 0xD8);
}

TEST_CASE("ComicArchive reads the RTL synthetic CBZ", "[ComicArchive]") {
  ComicArchive archive;
  REQUIRE(archive.open(fixturePath("rtl.cbz").string()));
  REQUIRE(archive.isOpen());

  CHECK(archive.pageCount() == 6);
  CHECK(archive.progressionDirection() == ProgressionDirection::Rtl);
}
