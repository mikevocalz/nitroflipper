#include "PageCurlSolver.h"
#include "GoldenData.h"

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <catch2/matchers/catch_matchers_vector.hpp>

#include <cmath>

using namespace nitroflipper;
using namespace Catch::Matchers;

TEST_CASE("Identity at flat progress", "[PageCurlSolver]") {
  Config cfg;
  cfg.mode = Mode::Single;
  cfg.spine = {Axis::Vertical, 0.0f};
  cfg.meshCols = 3;
  cfg.meshRows = 3;

  PageCurlSolver solver(200.0f, 300.0f, cfg);
  const Frame f = solver.tick(0.0f);

  REQUIRE(f.progress == 0.0f);
  REQUIRE(f.crossedThreshold == false);
  // Front vertices plus a duplicated back-face vertex set: 2 * (cols+1)*(rows+1) * 2 floats.
  REQUIRE(f.positions.size() == 64);

  // At theta=pi/2 the deformation is the identity, so output positions equal
  // the original book-space grid. Both front and back copies share positions.
  const int cols = cfg.meshCols;
  const int rows = cfg.meshRows;
  const size_t vertexCount = static_cast<size_t>((cols + 1) * (rows + 1));
  for (int row = 0; row <= rows; ++row) {
    for (int col = 0; col <= cols; ++col) {
      const float x = 200.0f * col / cols;
      const float y = 300.0f * row / rows;
      const size_t idx = static_cast<size_t>(row * (cols + 1) + col);
      CHECK(f.positions[idx * 2 + 0] == Catch::Approx(x).margin(1e-4f));
      CHECK(f.positions[idx * 2 + 1] == Catch::Approx(y).margin(1e-4f));
      CHECK(f.positions[(idx + vertexCount) * 2 + 0]
            == Catch::Approx(x).margin(1e-4f));
      CHECK(f.positions[(idx + vertexCount) * 2 + 1]
            == Catch::Approx(y).margin(1e-4f));
    }
  }
}

TEST_CASE("Spine vertices are invariant under deformation", "[PageCurlSolver]") {
  Config cfg;
  cfg.mode = Mode::Single;
  cfg.spine = {Axis::Vertical, 25.0f};
  cfg.meshCols = 8;
  cfg.meshRows = 8;

  PageCurlSolver solver(200.0f, 300.0f, cfg);
  REQUIRE(solver.beginGrab(195.0f, 100.0f));
  solver.updateGrab(125.0f, 100.0f); // progress ~0.5

  const Frame f = solver.tick(0.016f);
  REQUIRE(f.progress == Catch::Approx(0.5f).margin(1e-4f));

  const int cols = cfg.meshCols;
  const int rows = cfg.meshRows;
  for (int row = 0; row <= rows; ++row) {
    const size_t idx = static_cast<size_t>(row * (cols + 1)) * 2;
    // Spine is at x = spine.position.
    CHECK(f.positions[idx + 0] == Catch::Approx(cfg.spine.position).margin(1e-4f));
  }
}

TEST_CASE("Golden-file geometry comparison", "[PageCurlSolver]") {
  Config cfg;
  cfg.mode = Mode::Single;
  cfg.spine = {Axis::Vertical, 0.0f};
  cfg.meshCols = tests::golden::MESH_COLS;
  cfg.meshRows = tests::golden::MESH_ROWS;

  PageCurlSolver solver(tests::golden::PAGE_WIDTH, tests::golden::PAGE_HEIGHT, cfg);
  // Touch y=0 gives an actual cone apex of -PAGE_HEIGHT*1.5, matching the golden file.
  REQUIRE(solver.beginGrab(tests::golden::PAGE_WIDTH, 0.0f));
  solver.updateGrab(
      tests::golden::PAGE_WIDTH * (1.0f - tests::golden::PROGRESS), 0.0f);

  const Frame f = solver.tick(0.0f);

  REQUIRE(f.progress == Catch::Approx(tests::golden::PROGRESS).margin(1e-4f));
  REQUIRE(f.positions.size() == tests::golden::POSITIONS.size());
  REQUIRE(f.uvs.size() == tests::golden::UVS.size());
  REQUIRE(f.indices.size() == tests::golden::INDICES.size());

  for (size_t i = 0; i < f.positions.size(); ++i) {
    CHECK(f.positions[i]
          == Catch::Approx(tests::golden::POSITIONS[i]).margin(1e-4f));
  }
  for (size_t i = 0; i < f.indices.size(); ++i) {
    CHECK(f.indices[i] == tests::golden::INDICES[i]);
  }

  CHECK(f.frontRange.start == tests::golden::FRONT_START);
  CHECK(f.frontRange.count == tests::golden::FRONT_COUNT);
  CHECK(f.backRange.start == tests::golden::BACK_START);
  CHECK(f.backRange.count == tests::golden::BACK_COUNT);
}

TEST_CASE("Grab region hit-testing", "[PageCurlSolver]") {
  Config cfg;
  cfg.mode = Mode::Single;
  cfg.spine = {Axis::Vertical, 0.0f};
  cfg.grabbed = Leaf::Recto;
  cfg.rtl = false;

  PageCurlSolver solver(200.0f, 300.0f, cfg);

  // Near the active edge.
  CHECK(solver.beginGrab(170.0f, 50.0f) == true);
  // Anywhere else on the leaf also starts a curl: the grab band spans the
  // page so a reader can drag from the middle, not just a sliver at the edge.
  CHECK(solver.beginGrab(100.0f, 50.0f) == true);
  CHECK(solver.beginGrab(5.0f, 50.0f) == true);
  // Off the page (past the far end) is still refused.
  CHECK(solver.beginGrab(195.0f, 310.0f) == false);
  CHECK(solver.beginGrab(195.0f, -10.0f) == false);
}

TEST_CASE("Release physics commits on fast drag toward the opposite edge", "[PageCurlSolver]") {
  Config cfg;
  cfg.mode = Mode::Single;
  cfg.spine = {Axis::Vertical, 0.0f};
  cfg.grabbed = Leaf::Recto;
  cfg.rtl = false;

  PageCurlSolver solver(200.0f, 300.0f, cfg);
  REQUIRE(solver.beginGrab(200.0f, 150.0f));
  solver.updateGrab(100.0f, 150.0f);

  // Fast leftward velocity -> commit.
  solver.release(-600.0f, 0.0f);
  Frame f = solver.tick(0.0f);
  REQUIRE(f.progress == Catch::Approx(0.5f).margin(1e-4f));

  float t = 0.0f;
  while (t < 2.0f) {
    f = solver.tick(0.016f);
    t += 0.016f;
    if (f.progress >= 0.999f) {
      break;
    }
  }
  CHECK(f.progress == Catch::Approx(1.0f).margin(1e-3f));
}

TEST_CASE("Release physics snaps back on slow drag", "[PageCurlSolver]") {
  Config cfg;
  cfg.mode = Mode::Single;
  cfg.spine = {Axis::Vertical, 0.0f};
  cfg.grabbed = Leaf::Recto;
  cfg.rtl = false;

  PageCurlSolver solver(200.0f, 300.0f, cfg);
  REQUIRE(solver.beginGrab(200.0f, 150.0f));
  solver.updateGrab(100.0f, 150.0f);

  // Slow velocity -> snap back.
  solver.release(-50.0f, 0.0f);

  float t = 0.0f;
  Frame f = solver.tick(0.0f);
  while (t < 2.0f) {
    f = solver.tick(0.016f);
    t += 0.016f;
    if (f.progress <= 0.001f) {
      break;
    }
  }
  CHECK(f.progress == Catch::Approx(0.0f).margin(1e-3f));
}

TEST_CASE("Crossed threshold flag fires once", "[PageCurlSolver]") {
  Config cfg;
  cfg.mode = Mode::Single;
  cfg.spine = {Axis::Vertical, 0.0f};
  cfg.meshCols = 2;
  cfg.meshRows = 2;

  PageCurlSolver solver(200.0f, 300.0f, cfg);
  REQUIRE(solver.beginGrab(200.0f, 150.0f));
  solver.updateGrab(120.0f, 150.0f); // progress 0.4
  Frame f = solver.tick(0.0f);
  CHECK(f.crossedThreshold == false);

  solver.updateGrab(80.0f, 150.0f); // progress 0.6
  f = solver.tick(0.0f);
  CHECK(f.crossedThreshold == true);

  f = solver.tick(0.0f);
  CHECK(f.crossedThreshold == false);
}
