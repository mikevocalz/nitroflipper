#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace nitroflipper {

enum class Mode { Single, Spread };
enum class Leaf { Recto, Verso };
enum class Axis { Vertical, Horizontal };

struct Spine {
  Axis axis{Axis::Vertical};
  float position{0.0f};
};

struct Hinge {
  float start{0.0f};
  float end{0.0f};
  bool occludes{false};
};

struct Cone {
  float thetaRad{1.57079632679f}; // pi/2 == flat
  float apexV{0.0f};              // along the spine axis, book-space units
  float rhoRad{0.0f};             // rotation around the spine
};

struct Config {
  Mode mode{Mode::Single};
  Spine spine;
  std::optional<Hinge> hinge;
  Leaf grabbed{Leaf::Recto};
  bool rtl{false};
  int meshCols{32};
  int meshRows{32};
};

struct Range {
  size_t start{0};
  size_t count{0};
};

struct Rect {
  float x{0.0f};
  float y{0.0f};
  float width{0.0f};
  float height{0.0f};
};

struct Frame {
  // Vertex streams (book-space 2D positions, normalized UVs)
  std::span<const float> positions;
  std::span<const float> uvs;
  std::span<const uint16_t> indices;

  // Draw partitioning
  Range frontRange;
  Range backRange;
  Rect staticHalfClip;
  std::optional<Rect> gutterClip;

  // Shading
  std::span<const float> shadowPoly;
  std::span<const float> shadowAlpha;
  float spineShadowStrength{0.0f};

  // State
  float progress{0.0f};
  bool crossedThreshold{false};
};

class PageCurlSolver {
public:
  PageCurlSolver(float pageWidth, float pageHeight, Config config);

  bool beginGrab(float x, float y);
  void updateGrab(float x, float y);
  void release(float vx, float vy);
  Frame tick(float dt);

  [[nodiscard]] const Config& config() const noexcept { return _config; }
  [[nodiscard]] const Cone& cone() const noexcept { return _cone; }
  [[nodiscard]] bool isGrabbing() const noexcept { return _grabbing; }

private:
  void resetState();
  void generateMesh();
  void deformMesh();
  void updateShadow();
  void integrateRelease(float dt);

  [[nodiscard]] float pageCross() const noexcept;
  [[nodiscard]] float pageAlong() const noexcept;
  [[nodiscard]] bool isActiveEdgeAtMax() const noexcept;

  // Convert book-space (x,y) to local cone coordinates (u along cross, v along spine)
  struct LocalPoint {
    float u{0.0f};
    float v{0.0f};
  };
  [[nodiscard]] LocalPoint toLocal(float x, float y) const noexcept;
  [[nodiscard]] std::pair<float, float> toBook(float u, float v) const noexcept;

  // Clamp helpers
  static float clamp(float v, float lo, float hi) noexcept;
  static float lerp(float a, float b, float t) noexcept;

  Config _config;
  float _pageWidth{0.0f};
  float _pageHeight{0.0f};

  Cone _cone;

  // Grab/release state
  bool _grabbing{false};
  float _progress{0.0f};
  float _targetProgress{0.0f};
  float _velocityProgress{0.0f};
  float _grabApexV{0.0f};
  bool _released{false};
  bool _wasAboveThreshold{false};
  float _spineShadowStrength{0.0f};

  // Cached derived page dims
  float _pageCross{0.0f};
  float _pageAlong{0.0f};
  float _activeEdgeCross{0.0f};
  int _crossSign{1}; // +1 when active edge is at max, -1 when at min

  // Buffers
  std::vector<float> _positions;
  std::vector<float> _uvs;
  std::vector<float> _staticPositions; // pre-deformation positions for UV mapping
  std::vector<uint16_t> _indices;
  std::vector<float> _shadowPoly;
  std::vector<float> _shadowAlpha;

  Frame _frame;
};

} // namespace nitroflipper
