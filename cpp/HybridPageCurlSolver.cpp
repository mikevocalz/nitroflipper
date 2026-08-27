#include "HybridPageCurlSolver.hpp"

#include <NitroModules/ArrayBuffer.hpp>

namespace margelo::nitro::nitroflipper {

using namespace margelo::nitro;

HybridPageCurlSolver::HybridPageCurlSolver()
    : HybridObject(TAG), HybridPageCurlSolverSpec() {}

::nitroflipper::Config HybridPageCurlSolver::toNativeConfig(
    const Config& config) {
  ::nitroflipper::Spine spine{
      static_cast<::nitroflipper::Axis>(config.spineAxis),
      static_cast<float>(config.spinePosition)};

  std::optional<::nitroflipper::Hinge> hinge;
  if (config.hinge.has_value()) {
    hinge = ::nitroflipper::Hinge{
        static_cast<float>(config.hinge->start),
        static_cast<float>(config.hinge->end),
        config.hinge->occludes};
  }

  return ::nitroflipper::Config{
      static_cast<::nitroflipper::Mode>(config.mode),
      spine,
      hinge,
      static_cast<::nitroflipper::Leaf>(config.grabbed),
      config.rtl,
      static_cast<int>(config.meshCols),
      static_cast<int>(config.meshRows)};
}

Frame HybridPageCurlSolver::toNitroFrame(const ::nitroflipper::Frame& frame) {
  auto makeBuffer = [](std::span<const float> data) -> std::shared_ptr<ArrayBuffer> {
    const size_t size = data.size_bytes();
    return ArrayBuffer::copy(
        reinterpret_cast<const uint8_t*>(data.data()), size);
  };
  auto makeIndexBuffer = [](std::span<const uint16_t> data) -> std::shared_ptr<ArrayBuffer> {
    const size_t size = data.size_bytes();
    return ArrayBuffer::copy(
        reinterpret_cast<const uint8_t*>(data.data()), size);
  };

  Frame nf;
  nf.positions = makeBuffer(frame.positions);
  nf.uvs = makeBuffer(frame.uvs);
  nf.indices = makeIndexBuffer(frame.indices);

  nf.frontRangeStart = static_cast<double>(frame.frontRange.start);
  nf.frontRangeCount = static_cast<double>(frame.frontRange.count);
  nf.backRangeStart = static_cast<double>(frame.backRange.start);
  nf.backRangeCount = static_cast<double>(frame.backRange.count);

  nf.staticHalfClipX = static_cast<double>(frame.staticHalfClip.x);
  nf.staticHalfClipY = static_cast<double>(frame.staticHalfClip.y);
  nf.staticHalfClipWidth = static_cast<double>(frame.staticHalfClip.width);
  nf.staticHalfClipHeight = static_cast<double>(frame.staticHalfClip.height);

  nf.hasGutterClip = frame.gutterClip.has_value();
  nf.gutterClipX = nf.hasGutterClip
                      ? static_cast<double>(frame.gutterClip->x)
                      : 0.0;
  nf.gutterClipY = nf.hasGutterClip
                      ? static_cast<double>(frame.gutterClip->y)
                      : 0.0;
  nf.gutterClipWidth = nf.hasGutterClip
                          ? static_cast<double>(frame.gutterClip->width)
                          : 0.0;
  nf.gutterClipHeight = nf.hasGutterClip
                           ? static_cast<double>(frame.gutterClip->height)
                           : 0.0;

  nf.shadowPoly = makeBuffer(frame.shadowPoly);
  nf.shadowAlpha = makeBuffer(frame.shadowAlpha);
  nf.spineShadowStrength = static_cast<double>(frame.spineShadowStrength);
  nf.progress = static_cast<double>(frame.progress);
  nf.crossedThreshold = frame.crossedThreshold;
  return nf;
}

void HybridPageCurlSolver::init(
    double pageWidth,
    double pageHeight,
    const Config& config) {
  _solver = std::make_unique<::nitroflipper::PageCurlSolver>(
      static_cast<float>(pageWidth),
      static_cast<float>(pageHeight),
      toNativeConfig(config));
}

bool HybridPageCurlSolver::beginGrab(double x, double y) {
  if (!_solver) {
    return false;
  }
  return _solver->beginGrab(static_cast<float>(x), static_cast<float>(y));
}

void HybridPageCurlSolver::updateGrab(double x, double y) {
  if (!_solver) {
    return;
  }
  _solver->updateGrab(static_cast<float>(x), static_cast<float>(y));
}

void HybridPageCurlSolver::release(double vx, double vy) {
  if (!_solver) {
    return;
  }
  _solver->release(static_cast<float>(vx), static_cast<float>(vy));
}

Frame HybridPageCurlSolver::tick(double dt) {
  if (!_solver) {
    return Frame{};
  }
  const ::nitroflipper::Frame frame = _solver->tick(static_cast<float>(dt));
  return toNitroFrame(frame);
}

} // namespace margelo::nitro::nitroflipper
