#include "ComicArchive.h"

#define MINIZ_NO_ZLIB_COMPATIBLE_NAMES
#include "miniz.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <limits>
#include <regex>
#include <sstream>

namespace nitroflipper {

namespace {

std::string toLower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return s;
}

bool isJunkEntry(const std::string& filename) {
  if (filename.empty() || filename.back() == '/') {
    return true;
  }
  if (filename[0] == '.') {
    return true;
  }
  const std::string lower = toLower(filename);
  if (lower == "comicinfo.xml" ||
      lower.find("__macosx/") != std::string::npos ||
      lower == ".ds_store" ||
      lower == "thumbs.db") {
    return true;
  }
  return false;
}

std::string basename(const std::string& path) {
  size_t slash = path.find_last_of("/\\");
  if (slash == std::string::npos) return path;
  return path.substr(slash + 1);
}

// Natural sort: compare non-digit runs case-insensitively and digit runs
// numerically.
bool naturalLess(const std::string& a, const std::string& b) {
  size_t i = 0;
  size_t j = 0;
  while (i < a.size() && j < b.size()) {
    char ca = static_cast<char>(std::tolower(static_cast<unsigned char>(a[i])));
    char cb = static_cast<char>(std::tolower(static_cast<unsigned char>(b[j])));
    bool da = std::isdigit(static_cast<unsigned char>(a[i])) != 0;
    bool db = std::isdigit(static_cast<unsigned char>(b[j])) != 0;

    if (da && db) {
      size_t ia = i;
      size_t ib = j;
      while (ia < a.size() && std::isdigit(static_cast<unsigned char>(a[ia]))) ++ia;
      while (ib < b.size() && std::isdigit(static_cast<unsigned char>(b[ib]))) ++ib;
      // Compare numeric values, but preserve equal numeric runs for
      // lexicographic tie-breaking.
      long long na = 0;
      long long nb = 0;
      try {
        na = std::stoll(a.substr(i, ia - i));
      } catch (...) {}
      try {
        nb = std::stoll(b.substr(j, ib - j));
      } catch (...) {}
      if (na != nb) return na < nb;
      if (i != j) return a.substr(i, ia - i) < b.substr(j, ib - j);
      i = ia;
      j = ib;
    } else {
      if (ca != cb) return ca < cb;
      ++i;
      ++j;
    }
  }
  return a.size() < b.size();
}

// Try to read width/height from the first bytes of an encoded image.
PageBox sniffImageDimensions(const uint8_t* data, size_t len) {
  if (len < 8) return {0, 0};

  // PNG
  if (data[0] == 0x89 && std::memcmp(data + 1, "PNG", 3) == 0) {
    if (len >= 24) {
      uint32_t width = (static_cast<uint32_t>(data[16]) << 24) |
                       (static_cast<uint32_t>(data[17]) << 16) |
                       (static_cast<uint32_t>(data[18]) << 8) |
                       static_cast<uint32_t>(data[19]);
      uint32_t height = (static_cast<uint32_t>(data[20]) << 24) |
                        (static_cast<uint32_t>(data[21]) << 16) |
                        (static_cast<uint32_t>(data[22]) << 8) |
                        static_cast<uint32_t>(data[23]);
      return {static_cast<int>(width), static_cast<int>(height)};
    }
  }

  // JPEG
  if (data[0] == 0xFF && data[1] == 0xD8) {
    size_t i = 2;
    while (i + 8 < len) {
      if (data[i] != 0xFF) {
        ++i;
        continue;
      }
      uint8_t marker = data[i + 1];
      if (marker == 0xD9 || marker == 0xDA) break; // EOI / SOS
      if (marker == 0xC0 || marker == 0xC1 || marker == 0xC2) {
        if (i + 9 < len) {
          int height = (static_cast<int>(data[i + 5]) << 8) | data[i + 6];
          int width = (static_cast<int>(data[i + 7]) << 8) | data[i + 8];
          return {width, height};
        }
      }
      uint16_t segLen = (static_cast<uint16_t>(data[i + 2]) << 8) | data[i + 3];
      i += 2 + segLen;
    }
  }

  // WebP (lossy VP8)
  if (len >= 30 && std::memcmp(data, "RIFF", 4) == 0 &&
      std::memcmp(data + 8, "WEBP", 4) == 0) {
    if (std::memcmp(data + 12, "VP8 ", 4) == 0 && data[23] == 0x9D &&
        data[24] == 0x01 && data[25] == 0x2A) {
      int width = static_cast<int>(data[26]) |
                  ((static_cast<int>(data[27]) & 0x3F) << 8);
      int height = static_cast<int>(data[28]) |
                   ((static_cast<int>(data[29]) & 0x3F) << 8);
      return {width, height};
    }
    if (std::memcmp(data + 12, "VP8L", 4) == 0 && len >= 21) {
      uint32_t bits = (static_cast<uint32_t>(data[21]) << 16) |
                      (static_cast<uint32_t>(data[20]) << 8) |
                      static_cast<uint32_t>(data[19]);
      int width = 1 + (static_cast<int>(bits & 0x3FFF));
      int height = 1 + (static_cast<int>((bits >> 14) & 0x3FFF));
      return {width, height};
    }
  }

  return {0, 0};
}

std::string extractAttribute(
    const std::string& tag,
    const std::string& name) {
  std::string pattern = name + R"(=["']?([^"'>\s]+)["']?)";
  std::regex re(pattern, std::regex::icase);
  std::smatch match;
  if (std::regex_search(tag, match, re) && match.size() > 1) {
    return match[1].str();
  }
  return "";
}

std::vector<::nitroflipper::ComicInfoPage> parseComicInfo(const std::string& xml) {
  std::vector<::nitroflipper::ComicInfoPage> pages;
  size_t pos = 0;
  while ((pos = xml.find("<Page", pos)) != std::string::npos) {
    size_t end = xml.find(">", pos);
    if (end == std::string::npos) break;
    std::string tag = xml.substr(pos, end - pos + 1);
    ::nitroflipper::ComicInfoPage p;
    p.image = toLower(extractAttribute(tag, "Image"));
    std::string w = extractAttribute(tag, "ImageWidth");
    std::string h = extractAttribute(tag, "ImageHeight");
    if (!w.empty()) try { p.width = std::stoi(w); } catch (...) {}
    if (!h.empty()) try { p.height = std::stoi(h); } catch (...) {}
    std::string dp = extractAttribute(tag, "DoublePage");
    p.doublePage = (toLower(dp) == "true");
    std::string type = toLower(extractAttribute(tag, "Type"));
    p.frontCover = (type == "frontcover");
    if (!p.image.empty()) pages.push_back(p);
    pos = end + 1;
  }
  return pages;
}

ProgressionDirection parseMangaDirection(const std::string& xml) {
  size_t start = xml.find("<Manga>");
  if (start != std::string::npos) {
    size_t end = xml.find("</Manga>", start);
    if (end != std::string::npos) {
      std::string val = toLower(xml.substr(start + 7, end - start - 7));
      if (val.find("righttoleft") != std::string::npos) {
        return ProgressionDirection::Rtl;
      }
    }
  }
  return ProgressionDirection::Ltr;
}

} // namespace

ComicArchive::~ComicArchive() { close(); }

void ComicArchive::reset() {
  _isOpen = false;
  _path.clear();
  _pages.clear();
  _progressionDirection = ProgressionDirection::Ltr;
  _spreadIntent = SpreadIntent::Auto;
  if (_archive != nullptr) {
    auto* archive = static_cast<mz_zip_archive*>(_archive);
    mz_zip_reader_end(archive);
    delete archive;
    _archive = nullptr;
  }
}

void ComicArchive::close() { reset(); }

bool ComicArchive::open(const std::string& path) {
  reset();

  auto* archive = new mz_zip_archive();
  mz_zip_zero_struct(archive);
  if (!mz_zip_reader_init_file(archive, path.c_str(), 0)) {
    delete archive;
    return false;
  }

  _archive = archive;
  _path = path;

  auto entries = enumeratePageEntries();
  if (entries.empty()) {
    reset();
    return false;
  }

  applyComicInfo(entries);

  _pages.reserve(entries.size());
  for (const auto& e : entries) {
    ComicPage page;
    page.filename = e.filename;
    page.archiveIndex = e.index;
    deriveGeometry(page);
    _pages.push_back(std::move(page));
  }

  _isOpen = true;
  return true;
}

std::vector<ComicArchive::RawEntry> ComicArchive::enumeratePageEntries() {
  auto* archive = static_cast<mz_zip_archive*>(_archive);
  std::vector<RawEntry> entries;
  mz_uint count = mz_zip_reader_get_num_files(archive);
  for (mz_uint i = 0; i < count; ++i) {
    mz_uint nameLen = mz_zip_reader_get_filename(archive, i, nullptr, 0);
    if (nameLen <= 1) continue; // empty or just null terminator
    std::string name(nameLen, '\0');
    mz_zip_reader_get_filename(archive, i, name.data(), nameLen);
    if (!name.empty() && name.back() == '\0') name.pop_back();
    if (isJunkEntry(name)) continue;
    entries.push_back({i, std::move(name)});
  }
  std::sort(entries.begin(), entries.end(),
            [](const RawEntry& a, const RawEntry& b) {
              return naturalLess(a.filename, b.filename);
            });
  return entries;
}

void ComicArchive::applyComicInfo(const std::vector<RawEntry>& entries) {
  auto* archive = static_cast<mz_zip_archive*>(_archive);

  // Find ComicInfo.xml by case-insensitive name.
  size_t comicInfoIndex = std::numeric_limits<size_t>::max();
  mz_uint count = mz_zip_reader_get_num_files(archive);
  for (mz_uint i = 0; i < count; ++i) {
    mz_uint nameLen = mz_zip_reader_get_filename(archive, i, nullptr, 0);
    if (nameLen <= 1) continue;
    std::string name(nameLen, '\0');
    mz_zip_reader_get_filename(archive, i, name.data(), nameLen);
    if (!name.empty() && name.back() == '\0') name.pop_back();
    if (toLower(basename(name)) == "comicinfo.xml") {
      comicInfoIndex = static_cast<size_t>(i);
      break;
    }
  }

  if (comicInfoIndex == std::numeric_limits<size_t>::max()) {
    return;
  }

  size_t xmlLen = 0;
  void* xmlData = mz_zip_reader_extract_to_heap(
      archive, static_cast<mz_uint>(comicInfoIndex), &xmlLen, 0);
  if (!xmlData) return;
  std::string xml(static_cast<const char*>(xmlData), xmlLen);
  mz_free(xmlData);

  _progressionDirection = parseMangaDirection(xml);

  auto infoPages = parseComicInfo(xml);
  if (infoPages.empty()) return;

  std::unordered_map<std::string, ComicInfoPage> infoByName;
  for (const auto& p : infoPages) {
    infoByName[p.image] = p;
  }

  for (const auto& e : entries) {
    auto it = infoByName.find(toLower(basename(e.filename)));
    if (it == infoByName.end()) continue;

    // Store the metadata temporarily on a per-entry basis by mutating the
    // entry vector. We cannot do that directly, so we remember the first
    // ComicInfo double-page/cover presence for spread intent.
    if (it->second.doublePage || it->second.frontCover) {
      _spreadIntent = SpreadIntent::Both;
    }
  }

  // We apply ComicInfo geometry in deriveGeometry by checking the same map
  // again. To avoid extracting twice, keep the parsed map as a member?
  // ComicInfo files are tiny, so re-parsing once is fine. Simpler: store
  // the parsed data in a member map and reuse it in deriveGeometry.
  // Here we attach it to the archive as an ad-hoc user pointer instead.
  // But we own the archive; we can store it on this class.
  _comicInfoPages = std::move(infoByName);
}

void ComicArchive::deriveGeometry(ComicPage& page) {
  // First try ComicInfo.xml dimensions.
  auto it = _comicInfoPages.find(toLower(basename(page.filename)));
  if (it != _comicInfoPages.end()) {
    if (it->second.width > 0 && it->second.height > 0) {
      page.box = {it->second.width, it->second.height};
    }
    page.doublePage = it->second.doublePage;
    page.isCover = it->second.frontCover;
  }

  // If ComicInfo did not provide dimensions, sniff the image header.
  if (page.box.width == 0 || page.box.height == 0) {
    auto header = readFirstBytes(page.archiveIndex, 64 * 1024);
    if (!header.empty()) {
      page.box = sniffImageDimensions(header.data(), header.size());
    }
  }

  if (page.isCover || page.doublePage) {
    page.slot = SpreadSlot::Center;
  }
}

std::vector<uint8_t> ComicArchive::readFirstBytes(uint32_t fileIndex, size_t maxBytes) {
  auto* archive = static_cast<mz_zip_archive*>(_archive);
  mz_zip_archive_file_stat stat{};
  if (!mz_zip_reader_file_stat(archive, fileIndex, &stat)) {
    return {};
  }
  size_t toRead = std::min(maxBytes, static_cast<size_t>(stat.m_uncomp_size));
  if (toRead == 0) return {};
  std::vector<uint8_t> result(toRead);
  if (!mz_zip_reader_extract_to_mem(
          archive, fileIndex, result.data(), toRead, 0)) {
    return {};
  }
  return result;
}

const ComicPage& ComicArchive::page(size_t index) const {
  if (index >= _pages.size()) {
    static const ComicPage empty;
    return empty;
  }
  return _pages[index];
}

std::vector<uint8_t> ComicArchive::readPageBytes(size_t index) const {
  if (index >= _pages.size() || _archive == nullptr) {
    return {};
  }
  auto* archive = static_cast<mz_zip_archive*>(_archive);
  size_t len = 0;
  void* data = mz_zip_reader_extract_to_heap(
      archive, static_cast<mz_uint>(_pages[index].archiveIndex), &len, 0);
  if (!data) return {};
  std::vector<uint8_t> result(static_cast<const uint8_t*>(data),
                                static_cast<const uint8_t*>(data) + len);
  mz_free(data);
  return result;
}

} // namespace nitroflipper
