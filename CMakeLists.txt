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
