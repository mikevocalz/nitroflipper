#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace nitroflipper {

struct ScaledImage {
  std::vector<uint8_t> bytes; // JPEG-encoded
  int width{0};
  int height{0};
};

/**
 * Decode an encoded page and re-encode it no larger than the given box,
 * preserving aspect ratio.
 *
 * A comic page is ~2000x3000, which is ~24MB once decoded to RGBA, while the
 * slot it is drawn into is a fraction of that. Holding pages at source
 * resolution is what exhausts the image decoder while paging through a book.
 * Images already within the box are returned unchanged.
 */
std::optional<ScaledImage> scaleEncodedImage(
    std::span<const uint8_t> encoded,
    int maxWidth,
    int maxHeight,
    int quality = 85);

} // namespace nitroflipper
