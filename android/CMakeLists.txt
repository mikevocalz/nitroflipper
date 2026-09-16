cmake_minimum_required(VERSION 3.13)
project(NitroFlipper)

set(CMAKE_CXX_STANDARD 20)

add_library(
  NitroFlipper
  SHARED
  cpp-adapter.cpp
)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroFlipper+autolinking.cmake)

target_sources(
  NitroFlipper
  PRIVATE
  ../cpp/PageCurlSolver.cpp
  ../cpp/HybridPageCurlSolver.cpp
  ../cpp/ComicArchive.cpp
  ../cpp/ImageScaler.cpp
  ../cpp/HybridComicArchiveSource.cpp
  ../cpp/vendor/miniz/miniz.c
)

target_include_directories(
  NitroFlipper
  PRIVATE
  ../cpp
  ../cpp/vendor/miniz
  ../cpp/vendor/stb
)

# --- MuPDF document engine (PDF + EPUB) --------------------------------------
#
# On by default. Turning it off drops PDF and EPUB and leaves CBZ working, for
# anyone who wants the smaller binary or does not want the AGPL obligation --
# see docs/licensing.md, which is required reading before shipping this.
#
# Cost when on, measured for arm64-v8a: about 15MB added to the stripped .so
# and roughly 40s of first build. Gradle caches it after that.
option(NITROFLIPPER_WITH_MUPDF "Build the MuPDF-backed PDF/EPUB engine" ON)

if(NITROFLIPPER_WITH_MUPDF)
  add_subdirectory(${CMAKE_SOURCE_DIR}/../third_party/mupdf mupdf-build)

  target_sources(
    NitroFlipper
    PRIVATE
    ../cpp/mupdf/FzGuard.cpp
    ../cpp/mupdf/MuPDFDocument.cpp
    ../cpp/mupdf/DocumentExecutor.cpp
    ../cpp/HybridMuPDFFactory.cpp
    ../cpp/HybridMuPDFDocument.cpp
    ../cpp/HybridRenderedPage.cpp
  )

  target_include_directories(NitroFlipper PRIVATE ../cpp/mupdf)
  target_link_libraries(NitroFlipper mupdf)
  target_compile_definitions(NitroFlipper PRIVATE NITROFLIPPER_WITH_MUPDF=1)

  # MuPDF is a general-purpose library and a reader touches a fraction of it.
  # AGP already compiles with -ffunction-sections -fdata-sections but never
  # collects, so every unreferenced filter, writer and colourspace ships.
  # Measured on arm64-v8a: 27.7MB -> see docs/mupdf-integration-status.md.
  target_link_options(NitroFlipper PRIVATE -Wl,--gc-sections)
endif()
