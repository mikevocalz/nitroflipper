require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroFlipper"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"] || "https://github.com/mikevocalz/nitroflipper"
  s.license      = package["license"]
  s.authors      = package["author"] || { "mikevocalz" => "mikefacesny@gmail.com" }

  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/mikevocalz/nitroflipper.git", :tag => "#{s.version}" }

  s.source_files = [
    "cpp/**/*.{h,hpp,c,cpp}",
    "ios/**/*.{h,hpp,m,mm,swift}",
  ]

  # The vendored decoders are third-party C that does not compile warning-clean
  # and is not ours to fix. stb is header-only, so excluding it costs nothing.
  # miniz is not: ComicArchive calls into it, so excluding miniz.c compiled
  # headers-only and left every mz_* symbol undefined at link time, which is a
  # CBZ reader that cannot link on iOS at all. It is compiled here with its
  # warnings turned off rather than dropped. Android already builds it, through
  # add_library(miniz ...) in CMakeLists.txt.
  s.exclude_files = "cpp/vendor/stb/**/*"
  s.preserve_paths = "cpp/vendor/**/*"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    # miniz.c is vendored third-party C and is not ours to make warning-clean.
    "WARNING_CFLAGS" => "-Wno-everything",
    # Page decoding is CPU-bound C++ and a Debug pod builds at -O0, which on
    # device costs seconds per page turn. Optimize this pod in Debug too.
    "GCC_OPTIMIZATION_LEVEL[config=Debug]" => "2",
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/cpp\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp/mupdf\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp/vendor/miniz\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp/vendor/stb\"",
    ].join(" "),
  }

  # --- MuPDF ------------------------------------------------------------------
  #
  # MuPDF has shipped no iOS build target since 1.26, so the package builds it
  # from the pinned, checksummed source through its own CMake and packages the
  # result as an xcframework. Device and simulator are separate slices because
  # both are arm64 and a fat static library cannot hold both.
  #
  # Built at `pod install` time rather than checked in: the artifact is tens of
  # megabytes and would bloat both the repo and the npm tarball. The script
  # skips the build when the xcframework is newer than the CMake inputs, so
  # repeat installs are fast.
  #
  # LICENSING: linking this makes MuPDF's AGPL-3.0 apply to the app unless an
  # Artifex commercial licence is held. Read docs/licensing.md before shipping.
  # Set NITROFLIPPER_WITHOUT_MUPDF=1 to build CBZ-only without it.
  unless ENV["NITROFLIPPER_WITHOUT_MUPDF"] == "1"
    s.prepare_command = "bash scripts/build-mupdf-apple.sh"
    s.vendored_frameworks = "ios/generated/mupdf.xcframework"
  else
    # Without the engine the MuPDF sources cannot compile, so drop them and
    # leave the CBZ source and the curl solver intact.
    s.exclude_files = [
      "cpp/vendor/**/*",
      "cpp/mupdf/**/*",
      "cpp/HybridMuPDF*.{hpp,cpp}",
      "cpp/HybridRenderedPage.{hpp,cpp}",
    ]
  end

  # Pulls in React-Core, the New Architecture pods, and NitroModules, and adds
  # every Nitrogen-generated source and header to this target.
  load File.join(__dir__, "nitrogen", "generated", "ios", "NitroFlipper+autolinking.rb")
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
