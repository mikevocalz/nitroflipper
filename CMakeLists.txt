cmake_minimum_required(VERSION 3.16)
project(nitro-flipper VERSION 0.0.1 LANGUAGES C CXX)

if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(miniz STATIC cpp/vendor/miniz/miniz.c)
target_include_directories(miniz PUBLIC cpp/vendor/miniz)

add_library(pagecurlsolver STATIC cpp/PageCurlSolver.cpp)
target_include_directories(pagecurlsolver PUBLIC cpp)

add_library(comicarchive STATIC cpp/ComicArchive.cpp)
target_include_directories(comicarchive PUBLIC cpp cpp/vendor/miniz)
target_link_libraries(comicarchive PUBLIC miniz)

include(FetchContent)
FetchContent_Declare(
  Catch2
  URL https://github.com/catchorg/Catch2/archive/refs/tags/v3.7.1.tar.gz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(Catch2)

add_executable(pagecurlsolver_test tests/PageCurlSolver.test.cpp)
target_link_libraries(pagecurlsolver_test PRIVATE pagecurlsolver Catch2::Catch2WithMain)

add_executable(comicarchive_test tests/ComicArchive.test.cpp)
target_link_libraries(comicarchive_test PRIVATE comicarchive Catch2::Catch2WithMain)

add_library(imagescaler cpp/ImageScaler.cpp)
target_include_directories(imagescaler PUBLIC cpp cpp/vendor/stb)

add_executable(imagescaler_test tests/ImageScaler.test.cpp)
target_link_libraries(imagescaler_test PRIVATE imagescaler Catch2::Catch2WithMain)
target_compile_definitions(imagescaler_test
  PRIVATE FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures/output/pages")

# --- MuPDF-backed document engine --------------------------------------------
# Off by default: MuPDF is a 66MB download and a multi-minute first build, and
# the solver/archive tests above must stay fast. CI turns it on.
option(NITROFLIPPER_WITH_MUPDF "Build the MuPDF document engine and its tests" OFF)

if(NITROFLIPPER_WITH_MUPDF)
  add_subdirectory(third_party/mupdf)

  add_library(mupdfdocument STATIC
    cpp/mupdf/FzGuard.cpp
    cpp/mupdf/MuPDFDocument.cpp
    cpp/mupdf/DocumentExecutor.cpp
  )
  target_include_directories(mupdfdocument PUBLIC cpp cpp/mupdf)
  target_link_libraries(mupdfdocument PUBLIC mupdf)
  target_compile_features(mupdfdocument PUBLIC cxx_std_20)

  # The Nitro HybridObjects. Compiled here only to prove they build against the
  # generated specs; the app builds them through Nitrogen's autolinking, which
  # supplies react-native-nitro-modules' own headers and sources.
  # The generated specs include <NitroModules/Promise.hpp>. CocoaPods provides
  # that prefix through public_header_files and Android through prefab; neither
  # exists in a plain CMake build, so stage the same mapping here by copying the
  # headers into a NitroModules/ directory. This is only for the compile check
  # -- the app build gets the prefix from Nitrogen's autolinking.
  set(NITRO_CPP "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/react-native-nitro-modules/cpp")
  if(EXISTS "${NITRO_CPP}/core/Promise.hpp")
    set(NITRO_SHIM "${CMAKE_CURRENT_BINARY_DIR}/nitro-include")
    file(GLOB_RECURSE NITRO_HEADERS "${NITRO_CPP}/*.hpp" "${NITRO_CPP}/*.h")
    file(COPY ${NITRO_HEADERS} DESTINATION "${NITRO_SHIM}/NitroModules")
    set(NITRO_CORE_INCLUDE "${NITRO_SHIM}")
  endif()

  if(NITRO_CORE_INCLUDE)
    add_library(mupdfnitro OBJECT
      cpp/HybridMuPDFFactory.cpp
      cpp/HybridMuPDFDocument.cpp
      cpp/HybridRenderedPage.cpp
    )
    target_include_directories(mupdfnitro PRIVATE
      cpp
      cpp/mupdf
      nitrogen/generated/shared/c++
      "${NITRO_CORE_INCLUDE}"
      # Nitro's JSIConverter includes <jsi/jsi.h>, which lives in React Native
      # rather than in Nitro itself.
      "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/react-native/ReactCommon/jsi"
    )
    target_link_libraries(mupdfnitro PRIVATE mupdfdocument)
    target_compile_features(mupdfnitro PRIVATE cxx_std_20)
  else()
    message(STATUS
      "react-native-nitro-modules headers not found -- skipping the Nitro "
      "HybridObject compile check. Run npm install to enable it.")
  endif()

  add_executable(mupdfdocument_test tests/MuPDFDocument.test.cpp)
  target_link_libraries(mupdfdocument_test PRIVATE mupdfdocument Catch2::Catch2WithMain)
  target_compile_definitions(mupdfdocument_test
    PRIVATE FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures/output")
endif()

include(CTest)
enable_testing()
add_test(NAME pagecurlsolver COMMAND pagecurlsolver_test)
add_test(NAME comicarchive COMMAND comicarchive_test)
add_test(NAME imagescaler COMMAND imagescaler_test)
if(NITROFLIPPER_WITH_MUPDF)
  add_test(NAME mupdfdocument COMMAND mupdfdocument_test)
endif()
