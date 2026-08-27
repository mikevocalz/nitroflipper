#pragma once

#include "HybridPageCurlSolverSpec.hpp"
#include "PageCurlSolver.h"

#include <memory>

namespace margelo::nitro::nitroflipper {

class HybridPageCurlSolver : public HybridPageCurlSolverSpec {
public:
  HybridPageCurlSolver();

  void init(double pageWidth, double pageHeight, const Config& config) override;
  bool beginGrab(double x, double y) override;
  void updateGrab(double x, double y) override;
  void release(double vx, double vy) override;
  Frame tick(double dt) override;

private:
  static ::nitroflipper::Config toNativeConfig(const Config& config);
  static Frame toNitroFrame(const ::nitroflipper::Frame& frame);

  std::unique_ptr<::nitroflipper::PageCurlSolver> _solver;
};

} // namespace margelo::nitro::nitroflipper
