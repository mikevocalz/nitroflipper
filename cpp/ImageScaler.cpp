#include "ImageScaler.h"

#include <algorithm>
#include <cmath>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_STDIO
#include "stb_image.h"

#define STB_IMAGE_RESIZE_IMPLEMENTATION
#include "stb_image_resize2.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_WRITE_NO_STDIO
#include "stb_image_write.h"

namespace nitroflipper {

namespace {

constexpr int kChannels = 3; // RGB; comic pages carry no alpha

/** Owns a stbi_load_from_memory allocation. */
class StbPixels {
public:
  StbPixels(uint8_t* data) noexcept : _data(data) {}
  ~StbPixels() { if (_data != nullptr) stbi_image_free(_data); }
  StbPixels(const StbPixels&) = delete;
  StbPixels& operator=(const StbPixels&) = delete;

  const uint8_t* get() const noexcept { return _data; }
  explicit operator bool() const noexcept { return _data != nullptr; }

private:
  uint8_t* _data;
};

void appendByte(void* context, void* data, int size) {
  auto* out = static_cast<std::vector<uint8_t>*>(context);
  const auto* bytes = static_cast<const uint8_t*>(data);
  out->insert(out->end(), bytes, bytes + size);
}

} // namespace

std::optional<ScaledImage> scaleEncodedImage(
    std::span<const uint8_t> encoded,
    int maxWidth,
    int maxHeight,
    int quality) {
  if (encoded.empty() || maxWidth <= 0 || maxHeight <= 0) {
    return std::nullopt;
  }

  int srcW = 0;
  int srcH = 0;
  int srcChannels = 0;
  StbPixels src(stbi_load_from_memory(
      encoded.data(),
      static_cast<int>(encoded.size()),
      &srcW,
      &srcH,
      &srcChannels,
      kChannels));
  if (!src || srcW <= 0 || srcH <= 0) {
    return std::nullopt;
  }

  const double scale = std::min(
      {static_cast<double>(maxWidth) / srcW,
       static_cast<double>(maxHeight) / srcH,
       1.0});
  const int dstW = std::max(1, static_cast<int>(std::lround(srcW * scale)));
  const int dstH = std::max(1, static_cast<int>(std::lround(srcH * scale)));

  std::vector<uint8_t> pixels;
  const uint8_t* out = src.get();
  if (dstW != srcW || dstH != srcH) {
    pixels.resize(static_cast<size_t>(dstW) * dstH * kChannels);
    if (stbir_resize_uint8_srgb(
            src.get(), srcW, srcH, 0,
            pixels.data(), dstW, dstH, 0,
            STBIR_RGB) == nullptr) {
      return std::nullopt;
    }
    out = pixels.data();
  }

  ScaledImage result;
  result.width = dstW;
  result.height = dstH;
  result.bytes.reserve(static_cast<size_t>(dstW) * dstH / 2);
  if (stbi_write_jpg_to_func(
          appendByte, &result.bytes, dstW, dstH, kChannels, out, quality) == 0) {
    return std::nullopt;
  }
  return result;
}

} // namespace nitroflipper
