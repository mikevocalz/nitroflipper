cmake_minimum_required(VERSION 3.16)
project(nitro-flipper VERSION 0.0.1 LANGUAGES CXX)

if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(pagecurlsolver STATIC cpp/PageCurlSolver.cpp)
target_include_directories(pagecurlsolver PUBLIC cpp)

include(FetchContent)
FetchContent_Declare(
  Catch2
  URL https://github.com/catchorg/Catch2/archive/refs/tags/v3.7.1.tar.gz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(Catch2)

add_executable(pagecurlsolver_test tests/PageCurlSolver.test.cpp)
target_link_libraries(pagecurlsolver_test PRIVATE pagecurlsolver Catch2::Catch2WithMain)

include(CTest)
enable_testing()
add_test(NAME pagecurlsolver COMMAND pagecurlsolver_test)
