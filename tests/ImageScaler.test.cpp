#include <catch2/catch_test_macros.hpp>

#include <fstream>
#include <vector>

#include "ImageScaler.h"

using namespace nitroflipper;

namespace {

std::vector<uint8_t> readFixture(const char* path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

/** Reads the dimensions back out of an encoded JPEG. */
std::pair<int, int> jpegSize(const std::vector<uint8_t>& d) {
  for (size_t i = 2; i + 9 < d.size();) {
    if (d[i] != 0xFF) { ++i; continue; }
    const uint8_t marker = d[i + 1];
    if (marker == 0xD9 || marker == 0xDA) break;
    if (marker == 0xC0 || marker == 0xC1 || marker == 0xC2) {
      return {(d[i + 7] << 8) | d[i + 8], (d[i + 5] << 8) | d[i + 6]};
    }
    i += 2 + ((d[i + 2] << 8) | d[i + 3]);
  }
  return {0, 0};
}

} // namespace

TEST_CASE("Oversized pages are scaled into the box", "[ImageScaler]") {
  const auto page = readFixture(FIXTURE_DIR "/ltr_page01.jpg");
  REQUIRE_FALSE(page.empty());

  const auto scaled = scaleEncodedImage(page, 200, 300);
  REQUIRE(scaled.has_value());

  // 400x600 into a 200x300 box: aspect preserved, both sides inside the box.
  CHECK(scaled->width == 200);
  CHECK(scaled->height == 300);
  CHECK(scaled->width <= 200);
  CHECK(scaled->height <= 300);

  const auto [w, h] = jpegSize(scaled->bytes);
  CHECK(w == scaled->width);
  CHECK(h == scaled->height);

  // The whole point: fewer bytes to hold than the source.
  CHECK(scaled->bytes.size() < page.size());
}

TEST_CASE("Pages already inside the box keep their size", "[ImageScaler]") {
  const auto page = readFixture(FIXTURE_DIR "/ltr_page01.jpg");
  REQUIRE_FALSE(page.empty());

  const auto scaled = scaleEncodedImage(page, 4000, 4000);
  REQUIRE(scaled.has_value());
  CHECK(scaled->width == 400);
  CHECK(scaled->height == 600);
}

TEST_CASE("Garbage input is rejected", "[ImageScaler]") {
  const std::vector<uint8_t> junk(64, 0x7F);
  CHECK_FALSE(scaleEncodedImage(junk, 100, 100).has_value());
  CHECK_FALSE(scaleEncodedImage({}, 100, 100).has_value());
}
