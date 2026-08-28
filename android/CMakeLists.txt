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
  NitroFlipper PRIVATE
  ../cpp/PageCurlSolver.cpp
  ../cpp/HybridPageCurlSolver.cpp
  ../cpp/ComicArchive.cpp
  ../cpp/ImageScaler.cpp
  ../cpp/HybridComicArchiveSource.cpp
  ../cpp/vendor/miniz/miniz.c
)

target_include_directories(
  NitroFlipper PRIVATE
  ../cpp
  ../cpp/vendor/miniz
  ../cpp/vendor/stb
)
