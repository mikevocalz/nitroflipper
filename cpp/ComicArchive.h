#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace nitroflipper {

enum class ProgressionDirection { Ltr, Rtl };
enum class SpreadIntent { None, Landscape, Portrait, Both, Auto };
enum class Layout { Fixed, Reflowable };
enum class SpreadSlot { Left, Right, Center, Auto };

struct PageBox {
  int width{0};
  int height{0};
};

struct ComicPage {
  std::string filename;
  size_t archiveIndex{0}; // miniz file index, not page index
  PageBox box{0, 0};
  bool doublePage{false};
  bool isCover{false};
  SpreadSlot slot{SpreadSlot::Auto};
};

struct ComicInfoPage {
  std::string image;
  int width{0};
  int height{0};
  bool doublePage{false};
  bool frontCover{false};
};

/**
 * A CBZ/CBR-style comic archive reader.
 *
 * Responsibilities:
 *   - enumerate entries and filter non-page junk
 *   - natural-sort page filenames
 *   - parse optional ComicInfo.xml metadata
 *   - determine page geometry from ComicInfo.xml or image headers
 *   - extract encoded image bytes for a given page
 */
class ComicArchive {
public:
  ComicArchive() = default;
  ~ComicArchive();

  // Non-copyable because it owns a miniz handle.
  ComicArchive(const ComicArchive&) = delete;
  ComicArchive& operator=(const ComicArchive&) = delete;

  bool open(const std::string& path);
  void close();
  bool isOpen() const noexcept { return _isOpen; }

  size_t pageCount() const noexcept { return _pages.size(); }
  const ComicPage& page(size_t index) const;

  ProgressionDirection progressionDirection() const noexcept {
    return _progressionDirection;
  }
  SpreadIntent spreadIntent() const noexcept { return _spreadIntent; }

  std::vector<uint8_t> readPageBytes(size_t index) const;

private:
  struct RawEntry {
    uint32_t index{0};
    std::string filename;
  };

  void reset();
  std::vector<RawEntry> enumeratePageEntries();
  void applyComicInfo(const std::vector<RawEntry>& entries);
  void deriveGeometry(ComicPage& page);
  std::vector<uint8_t> readFirstBytes(uint32_t fileIndex, size_t maxBytes);

  bool _isOpen{false};
  std::string _path;
  void* _archive{nullptr}; // opaque mz_zip_archive pointer
  std::vector<ComicPage> _pages;
  std::unordered_map<std::string, ComicInfoPage> _comicInfoPages;
  ProgressionDirection _progressionDirection{ProgressionDirection::Ltr};
  SpreadIntent _spreadIntent{SpreadIntent::Auto};
};

} // namespace nitroflipper
