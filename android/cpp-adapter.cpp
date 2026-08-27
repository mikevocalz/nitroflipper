#include <jni.h>
#include <fbjni/fbjni.h>

#include "NitroFlipperOnLoad.hpp"
#include "HybridPageCurlSolver.hpp"
#include "HybridComicArchiveSource.hpp"

using namespace facebook::jni;

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return initialize(vm, []() {
    margelo::nitro::nitroflipper::registerAllNatives();
  });
}
