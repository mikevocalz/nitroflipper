#include "PageCurlSolver.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace nitroflipper {

namespace {
constexpr float kPi = 3.14159265358979323846f;
// Fraction of the page width that can start a curl, measured from the active
// edge. 1.0 lets the reader drag from anywhere on the leaf, the way iBooks and
// harism's CurlView behave; a fixed book-space band is a sliver on a big page.
constexpr float kGrabBandFraction = 1.0f;
constexpr float kReleaseSpeedThreshold = 400.0f; // book-space units / s
constexpr float kMinTheta = 0.15f;            // ~8.6 degrees, fully curled
constexpr float kApexMargin = 1.5f;           // keep the cone apex outside the page
constexpr float kSpring = 25.0f;
constexpr float kDamping = 8.0f;
constexpr float kMaxRotation = kPi * 0.95f;
} // namespace

PageCurlSolver::PageCurlSolver(float pageWidth, float pageHeight, Config config)
    : _config(std::move(config)), _pageWidth(pageWidth), _pageHeight(pageHeight) {
  _pageCross = (_config.spine.axis == Axis::Vertical) ? pageWidth : pageHeight;
  _pageAlong = (_config.spine.axis == Axis::Vertical) ? pageHeight : pageWidth;

  const bool rectoOnRight = !_config.rtl;
  const bool activeAtMax =
      (_config.grabbed == Leaf::Recto && rectoOnRight) ||
      (_config.grabbed == Leaf::Verso && !rectoOnRight);

  _activeEdgeCross = activeAtMax ? _pageCross : 0.0f;
  _crossSign = activeAtMax ? 1 : -1;

  const int cols = std::max(1, _config.meshCols);
  const int rows = std::max(1, _config.meshRows);
  const size_t vertexCount = static_cast<size_t>((cols + 1) * (rows + 1));
  _positions.resize(vertexCount * 2 * 2); // front + back copies
  _uvs.resize(vertexCount * 2 * 2);
  _staticPositions.resize(vertexCount * 2);

  const size_t cellCount = static_cast<size_t>(cols * rows);
  _indices.resize(cellCount * 6 * 2);

  _shadowPoly.resize(8);
  _shadowAlpha.resize(4);

  resetState();
  generateMesh();
  _frame = tick(0.0f);
}

void PageCurlSolver::resetState() {
  _cone = Cone{};
  _progress = 0.0f;
  _targetProgress = 0.0f;
  _velocityProgress = 0.0f;
  _grabbing = false;
  _released = false;
  _grabApexV = _pageAlong * 0.5f - _pageAlong * kApexMargin;
  _wasAboveThreshold = false;
}

float PageCurlSolver::pageCross() const noexcept {
  return _pageCross;
}

float PageCurlSolver::pageAlong() const noexcept {
  return _pageAlong;
}

bool PageCurlSolver::isActiveEdgeAtMax() const noexcept {
  return _activeEdgeCross > _pageCross * 0.5f;
}

PageCurlSolver::LocalPoint PageCurlSolver::toLocal(float x, float y) const noexcept {
  if (_config.spine.axis == Axis::Vertical) {
    return {x - _config.spine.position, y};
  }
  return {y - _config.spine.position, x};
}

std::pair<float, float> PageCurlSolver::toBook(float u, float v) const noexcept {
  if (_config.spine.axis == Axis::Vertical) {
    return {_config.spine.position + u, v};
  }
  return {v, _config.spine.position + u};
}

float PageCurlSolver::clamp(float v, float lo, float hi) noexcept {
  return std::max(lo, std::min(v, hi));
}

float PageCurlSolver::lerp(float a, float b, float t) noexcept {
  return a + (b - a) * t;
}

void PageCurlSolver::generateMesh() {
  const int cols = std::max(1, _config.meshCols);
  const int rows = std::max(1, _config.meshRows);
  const size_t vertexCount = static_cast<size_t>((cols + 1) * (rows + 1));

  size_t vidx = 0;
  for (int row = 0; row <= rows; ++row) {
    for (int col = 0; col <= cols; ++col) {
      const float u = _pageCross * static_cast<float>(col) / static_cast<float>(cols);
      const float v = _pageAlong * static_cast<float>(row) / static_cast<float>(rows);
      const auto [bx, by] = toBook(u, v);
      _staticPositions[vidx * 2 + 0] = bx;
      _staticPositions[vidx * 2 + 1] = by;

      // Front and back vertices share the same book-space position.
      const size_t frontIdx = vidx;
      const size_t backIdx = vidx + vertexCount;
      _positions[frontIdx * 2 + 0] = bx;
      _positions[frontIdx * 2 + 1] = by;
      _positions[backIdx * 2 + 0] = bx;
      _positions[backIdx * 2 + 1] = by;

      const float uvu = static_cast<float>(col) / static_cast<float>(cols);
      const float uvv = static_cast<float>(row) / static_cast<float>(rows);
      _uvs[frontIdx * 2 + 0] = uvu;
      _uvs[frontIdx * 2 + 1] = uvv;
      // Back face mirrors across the spine/curl axis.
      _uvs[backIdx * 2 + 0] = 1.0f - uvu;
      _uvs[backIdx * 2 + 1] = uvv;

      ++vidx;
    }
  }

  size_t iidx = 0;
  const auto addTriangle = [this, &iidx](uint16_t a, uint16_t b, uint16_t c) {
    _indices[iidx++] = a;
    _indices[iidx++] = b;
    _indices[iidx++] = c;
  };

  const int vpr = cols + 1;
  for (int row = 0; row < rows; ++row) {
    for (int col = 0; col < cols; ++col) {
      const uint16_t a = static_cast<uint16_t>((col + 0) + (row + 0) * vpr);
      const uint16_t b = static_cast<uint16_t>((col + 1) + (row + 0) * vpr);
      const uint16_t c = static_cast<uint16_t>((col + 0) + (row + 1) * vpr);
      const uint16_t d = static_cast<uint16_t>((col + 1) + (row + 1) * vpr);
      addTriangle(a, b, d);
      addTriangle(d, c, a);
    }
  }

  _frame.frontRange = {0, iidx};

  // Back face indices refer to the duplicated vertex set and use reversed winding.
  for (int row = 0; row < rows; ++row) {
    for (int col = 0; col < cols; ++col) {
      const uint16_t a = static_cast<uint16_t>((col + 0) + (row + 0) * vpr + vertexCount);
      const uint16_t b = static_cast<uint16_t>((col + 1) + (row + 0) * vpr + vertexCount);
      const uint16_t c = static_cast<uint16_t>((col + 0) + (row + 1) * vpr + vertexCount);
      const uint16_t d = static_cast<uint16_t>((col + 1) + (row + 1) * vpr + vertexCount);
      addTriangle(a, d, b);
      addTriangle(d, a, c);
    }
  }

  _frame.backRange = {_frame.frontRange.count, iidx - _frame.frontRange.count};
}

void PageCurlSolver::deformMesh() {
  const int cols = std::max(1, _config.meshCols);
  const int rows = std::max(1, _config.meshRows);
  const size_t vertexCount = static_cast<size_t>((cols + 1) * (rows + 1));

  const float theta = _cone.thetaRad;
  const float apex = _cone.apexV;
  const float rho = _cone.rhoRad;

  const float sinTheta = std::sin(theta);
  const float cosTheta = std::cos(theta);
  const float sinRho = std::sin(rho);
  const float cosRho = std::cos(rho);

  // Guard against degenerate cone (theta -> 0) and flat page (theta -> pi/2).
  const float safeSinTheta =
      std::max(sinTheta, std::numeric_limits<float>::epsilon());

  for (size_t i = 0; i < vertexCount; ++i) {
    const float bx = _staticPositions[i * 2 + 0];
    const float by = _staticPositions[i * 2 + 1];
    const auto local = toLocal(bx, by);
    const float u = local.u;
    const float v = local.v;

    const float dx = u;
    const float dy = v - apex;
    const float R = std::sqrt(dx * dx + dy * dy);

    float outX = bx;
    float outY = by;

    if (R > std::numeric_limits<float>::epsilon()) {
      const float r = R * sinTheta;
      const float alpha = std::asin(clamp(dx / R, -1.0f, 1.0f));
      const float beta = alpha / safeSinTheta;

      const float sinBeta = std::sin(beta);
      const float cosBeta = std::cos(beta);
      const float oneMinusCos = 1.0f - cosBeta;

      const float x1 = r * sinBeta;
      const float y1 = R + apex - r * oneMinusCos * sinTheta;
      const float z1 = r * oneMinusCos * cosTheta;

      // Project to 2D book-space after rotation around the spine axis.
      const float x2 = x1 * cosRho - z1 * sinRho;
      const float y2 = y1;
      const float z2 = x1 * sinRho + z1 * cosRho;
      (void)z2;

      const auto [bookX, bookY] = toBook(x2, y2);
      outX = bookX;
      outY = bookY;
    }

    _positions[i * 2 + 0] = outX;
    _positions[i * 2 + 1] = outY;
    _positions[(i + vertexCount) * 2 + 0] = outX;
    _positions[(i + vertexCount) * 2 + 1] = outY;
  }
}

void PageCurlSolver::updateShadow() {
  // Simple spine shadow: a band along the spine whose opacity decays outward.
  const float band = _pageCross * 0.06f;
  const float strength = 0.22f * (1.0f - _progress * 0.5f);

  if (_config.spine.axis == Axis::Vertical) {
    const float x = _config.spine.position;
    _shadowPoly[0] = x;
    _shadowPoly[1] = 0.0f;
    _shadowPoly[2] = x + band;
    _shadowPoly[3] = 0.0f;
    _shadowPoly[4] = x + band;
    _shadowPoly[5] = _pageHeight;
    _shadowPoly[6] = x;
    _shadowPoly[7] = _pageHeight;
  } else {
    const float y = _config.spine.position;
    _shadowPoly[0] = 0.0f;
    _shadowPoly[1] = y;
    _shadowPoly[2] = _pageWidth;
    _shadowPoly[3] = y;
    _shadowPoly[4] = _pageWidth;
    _shadowPoly[5] = y + band;
    _shadowPoly[6] = 0.0f;
    _shadowPoly[7] = y + band;
  }

  _shadowAlpha[0] = strength;
  _shadowAlpha[1] = 0.0f;
  _shadowAlpha[2] = 0.0f;
  _shadowAlpha[3] = strength;
  _spineShadowStrength = strength;
}

bool PageCurlSolver::beginGrab(float x, float y) {
  if (_pageCross <= 0.0f || _pageAlong <= 0.0f) {
    return false;
  }

  const auto local = toLocal(x, y);
  if (local.v < 0.0f || local.v > _pageAlong) {
    return false;
  }

  const float dist = std::abs(local.u - _activeEdgeCross);
  if (dist > _pageCross * kGrabBandFraction) {
    return false;
  }

  _grabbing = true;
  _released = false;
  _velocityProgress = 0.0f;
  updateGrab(x, y);
  return true;
}

void PageCurlSolver::updateGrab(float x, float y) {
  if (!_grabbing) {
    return;
  }

  const auto local = toLocal(x, y);
  const float u = clamp(local.u, 0.0f, _pageCross);
  const float v = clamp(local.v, 0.0f, _pageAlong);

  const float signedDistance = (u - _activeEdgeCross) * -_crossSign;
  _progress = clamp(signedDistance / _pageCross, 0.0f, 1.0f);
  _grabApexV = v - _pageAlong * kApexMargin;

  _targetProgress = _progress;
  _velocityProgress = 0.0f;
}

void PageCurlSolver::release(float vx, float vy) {
  if (!_grabbing) {
    return;
  }

  _grabbing = false;
  _released = true;

  const float speed = std::sqrt(vx * vx + vy * vy);
  // Directional velocity along the reading direction (toward the opposite edge).
  const float directional = _crossSign * vx * (_config.spine.axis == Axis::Vertical ? 1.0f : -1.0f);
  const bool fastEnough = speed > kReleaseSpeedThreshold;
  const bool towardCommit = directional < 0.0f;

  _targetProgress = (fastEnough && towardCommit) ? 1.0f : 0.0f;
  _velocityProgress = 0.0f;
}

void PageCurlSolver::integrateRelease(float dt) {
  if (!_released) {
    return;
  }
  if (dt <= 0.0f) {
    return;
  }

  const float displacement = _targetProgress - _progress;
  const float acceleration = kSpring * displacement - kDamping * _velocityProgress;
  _velocityProgress += acceleration * dt;
  _progress += _velocityProgress * dt;

  if (std::abs(displacement) < 0.001f && std::abs(_velocityProgress) < 0.01f) {
    _progress = _targetProgress;
    _velocityProgress = 0.0f;
    _released = false;
  }

  _progress = clamp(_progress, 0.0f, 1.0f);
}

Frame PageCurlSolver::tick(float dt) {
  if (_released) {
    integrateRelease(dt);
  }

  _cone.thetaRad = lerp(kMinTheta, kPi * 0.5f, 1.0f - _progress);
  _cone.apexV = _grabApexV;
  _cone.rhoRad = static_cast<float>(_crossSign) * _progress * kMaxRotation;

  deformMesh();
  updateShadow();

  bool aboveThreshold = _progress >= 0.5f;
  _frame.crossedThreshold = aboveThreshold && !_wasAboveThreshold;
  _wasAboveThreshold = aboveThreshold;

  _frame.progress = _progress;
  _frame.positions = std::span<const float>(_positions);
  _frame.uvs = std::span<const float>(_uvs);
  _frame.indices = std::span<const uint16_t>(_indices);
  _frame.shadowPoly = std::span<const float>(_shadowPoly);
  _frame.shadowAlpha = std::span<const float>(_shadowAlpha);
  _frame.spineShadowStrength = _spineShadowStrength;

  // Whole-page clip for the static content underneath.
  if (_config.spine.axis == Axis::Vertical) {
    _frame.staticHalfClip = {0.0f, 0.0f, _pageWidth, _pageHeight};
  } else {
    _frame.staticHalfClip = {0.0f, 0.0f, _pageWidth, _pageHeight};
  }

  if (_config.hinge.has_value() && _config.hinge->occludes) {
    _frame.gutterClip = Rect{
        _config.spine.position + _config.hinge->start,
        0.0f,
        _config.hinge->end - _config.hinge->start,
        _pageAlong,
    };
  } else {
    _frame.gutterClip = std::nullopt;
  }

  return _frame;
}

} // namespace nitroflipper
