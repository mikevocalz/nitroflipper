# MuPDF, built from source for every NitroFlipper target.
#
# MuPDF ships no CMake build, and 1.26 removed the iOS sections from its
# Makefile, so there is no upstream mobile target to lean on. Both platforms
# therefore compile the same sources through this file: one place for the
# feature flags, one place for the thirdparty selection, and no hand-copied
# binaries.
#
# LICENSING: MuPDF is AGPL-3.0 / Artifex commercial, not MIT. Linking this
# target into an application makes the AGPL apply to that application unless a
# commercial licence is held. See docs/licensing.md.

cmake_minimum_required(VERSION 3.22)

set(MUPDF_VERSION "1.28.4" CACHE STRING "Pinned MuPDF release")
# Tarball from https://mupdf.com/downloads/archive/, which redirects to the
# ArtifexSoftware/mupdf-downloads GitHub release. Upstream tag 1.28.4 is
# ce933bdebe05fe54ba9d69792ed268efd9e00047.
set(MUPDF_URL_SHA256
    "2d97e043a616f96b148657c9c3d81ad71c4bd2052c59a2a3315ad842599340f9")
set(MUPDF_UPSTREAM_TAG "ce933bdebe05fe54ba9d69792ed268efd9e00047")

# A local tarball or pre-extracted tree short-circuits the download, which is
# what CI caches and what an offline build uses.
set(MUPDF_SOURCE_DIR "" CACHE PATH "Pre-extracted MuPDF source tree")

if(MUPDF_SOURCE_DIR)
  set(MUPDF_DIR "${MUPDF_SOURCE_DIR}")
  message(STATUS "MuPDF: using local tree ${MUPDF_DIR}")
else()
  include(FetchContent)
  # DOWNLOAD_EXTRACT_TIMESTAMP only exists from CMake 3.24. Android Studio
  # ships 3.22.1, where the unknown keyword is not rejected -- it is appended
  # to the preceding URL_HASH, which then fails to parse as ALGO=hex. Passing
  # it conditionally is the difference between building and a confusing hash
  # error that has nothing to do with the hash.
  set(MUPDF_FETCH_EXTRA "")
  if(CMAKE_VERSION VERSION_GREATER_EQUAL 3.24)
    set(MUPDF_FETCH_EXTRA DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
  endif()
  FetchContent_Declare(
    mupdf
    URL "https://mupdf.com/downloads/archive/mupdf-${MUPDF_VERSION}-source.tar.gz"
    URL_HASH "SHA256=${MUPDF_URL_SHA256}"
    ${MUPDF_FETCH_EXTRA}
  )
  FetchContent_MakeAvailable(mupdf)
  set(MUPDF_DIR "${mupdf_SOURCE_DIR}")
endif()

if(NOT EXISTS "${MUPDF_DIR}/include/mupdf/fitz.h")
  message(FATAL_ERROR "MuPDF source tree at ${MUPDF_DIR} has no include/mupdf/fitz.h")
endif()

include("${CMAKE_CURRENT_LIST_DIR}/mupdf_sources.cmake")

# --- Feature selection -------------------------------------------------------
#
# Every flag here is #ifndef-guarded in include/mupdf/fitz/config.h, so defining
# it on the command line wins. Each disabled feature must also have its
# thirdparty sources absent from mupdf_sources.cmake -- the two lists are the
# same decision expressed twice, and they have to agree or the link breaks.
#
# Kept: PDF, HTML/EPUB (+FB2, MOBI, TXT for free), CBZ/IMG, JPX, BROTLI, ICC.
# Dropped: XPS and SVG (not reader formats), JS (mujs -- PDF form scripting is
# an attack surface we do not need), OCR (tesseract+leptonica, ~18MB),
# BARCODE (zint+zxing, ~26MB), DOCX/ODT/OCR output (the `extract` library),
# OFFICE and MD (pull in cmark-gfm and office parsing we do not surface).
set(MUPDF_FEATURE_DEFS
  FZ_ENABLE_PDF=1
  FZ_ENABLE_HTML=1
  FZ_ENABLE_EPUB=1
  FZ_ENABLE_CBZ=1
  FZ_ENABLE_IMG=1
  FZ_ENABLE_FB2=1
  FZ_ENABLE_MOBI=1
  FZ_ENABLE_TXT=1
  FZ_ENABLE_JPX=1
  FZ_ENABLE_BROTLI=1
  FZ_ENABLE_ICC=1

  FZ_ENABLE_XPS=0
  FZ_ENABLE_SVG=0
  FZ_ENABLE_JS=0
  FZ_ENABLE_OFFICE=0
  FZ_ENABLE_MD=0
  FZ_ENABLE_OCR_OUTPUT=0
  FZ_ENABLE_ODT_OUTPUT=0
  FZ_ENABLE_DOCX_OUTPUT=0
  FZ_ENABLE_BARCODE=0
)

# --- Thirdparty --------------------------------------------------------------
# Each is compiled with the flags Makelists uses. Deviating here is how you get
# a library that builds and then misbehaves at run time, so the flags are
# copied rather than reinvented.

add_library(mupdf_thirdparty STATIC
  ${MUPDF_FREETYPE_SRC}
  ${MUPDF_GUMBO_SRC}
  ${MUPDF_HARFBUZZ_SRC}
  ${MUPDF_JBIG2DEC_SRC}
  ${MUPDF_LCMS2_SRC}
  ${MUPDF_OPENJPEG_SRC}
  ${MUPDF_BROTLI_SRC}
  ${MUPDF_ZLIB_SRC}
  ${MUPDF_LIBJPEG_SRC}
)

target_include_directories(mupdf_thirdparty PUBLIC
  "${MUPDF_DIR}/include"
  "${MUPDF_DIR}/thirdparty/freetype/include"
  "${MUPDF_DIR}/thirdparty/harfbuzz/src"
  "${MUPDF_DIR}/thirdparty/gumbo-parser/src"
  "${MUPDF_DIR}/thirdparty/jbig2dec"
  "${MUPDF_DIR}/thirdparty/lcms2/include"
  "${MUPDF_DIR}/thirdparty/openjpeg/src/lib/openjp2"
  "${MUPDF_DIR}/thirdparty/brotli/c/include"
  "${MUPDF_DIR}/thirdparty/zlib"
  "${MUPDF_DIR}/thirdparty/libjpeg"
)
target_include_directories(mupdf_thirdparty PRIVATE
  "${MUPDF_DIR}/scripts/freetype"
  "${MUPDF_DIR}/scripts/libjpeg"
  "${MUPDF_DIR}/include/mupdf"
)

target_compile_definitions(mupdf_thirdparty PUBLIC
  ${MUPDF_FEATURE_DEFS}
  OPJ_STATIC
  OPJ_HAVE_INTTYPES_H
  OPJ_HAVE_STDINT_H
  HAVE_LCMS2MT
  LCMS2MT_PREFIX=lcms2mt_
)
target_compile_definitions(mupdf_thirdparty PRIVATE
  FT2_BUILD_LIBRARY
  "FT_CONFIG_MODULES_H=\"slimftmodules.h\""
  "FT_CONFIG_OPTIONS_H=\"slimftoptions.h\""
  HAVE_UNISTD_H
  HAVE_STDARG_H
  HAVE_STDINT_H
  "JBIG_EXTERNAL_MEMENTO_H=\"mupdf/memento.h\""
  MUTEX_pthread=0
  # HarfBuzz allocates through fitz so its memory shows up in fz_ budgets.
  HAVE_FALLBACK=1
  HAVE_FREETYPE
  HAVE_OT
  HAVE_ROUND
  HAVE_UCDN
  HB_NO_MT
  HB_NO_PRAGMA_GCC_DIAGNOSTIC
  hb_malloc_impl=fz_hb_malloc
  hb_calloc_impl=fz_hb_calloc
  hb_free_impl=fz_hb_free
  hb_realloc_impl=fz_hb_realloc
)

set_source_files_properties(${MUPDF_HARFBUZZ_SRC} PROPERTIES
  COMPILE_OPTIONS "-fno-exceptions;-fno-rtti;-fno-threadsafe-statics;-fvisibility-inlines-hidden;-w")
set_source_files_properties(${MUPDF_GUMBO_SRC} PROPERTIES COMPILE_OPTIONS "-w")
set_source_files_properties(${MUPDF_FREETYPE_SRC} PROPERTIES COMPILE_OPTIONS "-w")
set_source_files_properties(${MUPDF_LIBJPEG_SRC} PROPERTIES COMPILE_OPTIONS "-w")
set_source_files_properties(${MUPDF_OPENJPEG_SRC} PROPERTIES COMPILE_OPTIONS "-w")
set_source_files_properties(${MUPDF_LCMS2_SRC} PROPERTIES COMPILE_OPTIONS "-w")
set_source_files_properties(${MUPDF_BROTLI_SRC} PROPERTIES COMPILE_OPTIONS "-w")
set_source_files_properties(${MUPDF_JBIG2DEC_SRC} PROPERTIES COMPILE_OPTIONS "-w")
set_source_files_properties(${MUPDF_ZLIB_SRC} PROPERTIES COMPILE_OPTIONS "-w")

# --- MuPDF proper ------------------------------------------------------------
# Globbed because these directories are wholesale inclusions; CONFIGURE_DEPENDS
# keeps a re-extracted tree from going stale. The two OCR/barcode translation
# units are C++ and pull in tesseract and zxing, so they are dropped to match
# the feature flags above.

# --- Embedded fonts ----------------------------------------------------------
#
# MuPDF compiles its fallback fonts into the binary as C arrays under
# generated/resources/fonts. Shipping all of them costs 204MB of source (~51MB
# of .rodata) per ABI, which no mobile app can carry:
#
#   urw    2.5M   base-14 PDF fonts             -- mandatory, PDF requires them
#   sil    776K   CharisSIL, EPUB default serif -- mandatory for readable EPUB
#   noto    54M   script coverage               -- Arabic, Hebrew, Devanagari, Thai
#   droid   35M   CJK fallback
#   han    112M   full CJK
#
# The TOFU_* defines must agree exactly with the file list: noto.c has matching
# #if tests, so a mismatch is either a link error or a font that is compiled in
# and never reachable. Both are set together here for that reason.
#
#   no-cjk  (default) urw + sil + noto. Latin, Cyrillic, Greek, Arabic, Hebrew,
#                     Indic and Thai render. CJK renders as tofu. ~14MB/ABI.
#   full              everything. ~51MB/ABI. For a CJK-reading build.
#   minimal           urw + sil only. Latin and Cyrillic. ~0.8MB/ABI.
set(NITROFLIPPER_MUPDF_FONTS "no-cjk" CACHE STRING
    "Embedded font coverage: full | no-cjk | minimal")
set_property(CACHE NITROFLIPPER_MUPDF_FONTS PROPERTY STRINGS full no-cjk minimal)

set(MUPDF_FONT_DIR "${MUPDF_DIR}/generated/resources/fonts")

# The release tarball pre-generates ONLY the urw base-14 fonts. Every other
# family ships as the raw .cff/.otf/.ttf under resources/fonts, and upstream's
# Makefile turns those into C arrays with scripts/hexdump.sh during the build.
# We have no Makefile, so do the same here.
#
# Generated at configure time rather than through add_custom_command, because
# the resulting .c files have to exist before they can be listed as sources.
# Each file is skipped when it already exists, so this costs once per tree.
function(mupdf_generate_fonts family extension out_var)
  set(generated "")
  file(GLOB binaries "${MUPDF_DIR}/resources/fonts/${family}/*.${extension}")
  if(NOT binaries)
    set(${out_var} "" PARENT_SCOPE)
    return()
  endif()
  # Only generated/resources/fonts/urw exists in the tarball; every other
  # family's directory has to be made before execute_process can redirect into
  # it, or it fails with a bare "No such file or directory" that names the
  # input rather than the missing output directory.
  file(MAKE_DIRECTORY "${MUPDF_FONT_DIR}/${family}")
  foreach(binary IN LISTS binaries)
    get_filename_component(name "${binary}" NAME)
    set(target "${MUPDF_FONT_DIR}/${family}/${name}.c")
    if(NOT EXISTS "${target}")
      execute_process(
        COMMAND bash "${MUPDF_DIR}/scripts/hexdump.sh" "${binary}"
        OUTPUT_FILE "${target}"
        RESULT_VARIABLE status
      )
      if(NOT status EQUAL 0)
        # Remove the partial file, or the next configure trusts it.
        file(REMOVE "${target}")
        message(FATAL_ERROR "hexdump.sh failed for ${binary} (status ${status})")
      endif()
    endif()
    list(APPEND generated "${target}")
  endforeach()
  set(${out_var} "${generated}" PARENT_SCOPE)
endfunction()

file(GLOB MUPDF_FONT_URW CONFIGURE_DEPENDS "${MUPDF_FONT_DIR}/urw/*.c")
if(NOT MUPDF_FONT_URW)
  message(FATAL_ERROR
    "No embedded fonts under ${MUPDF_FONT_DIR}/urw. Those ship pre-generated "
    "in the *-source tarball; this looks like a git checkout instead.")
endif()

# Generated on demand below, only for the families the selected set needs.
set(MUPDF_FONT_SIL "")
set(MUPDF_FONT_NOTO "")
set(MUPDF_FONT_DROID "")
set(MUPDF_FONT_HAN "")

set(MUPDF_FONT_DEFS "")

if(NITROFLIPPER_MUPDF_FONTS STREQUAL "minimal")
  # urw only. TOFU_SIL and TOFU_NOTO must be set together with omitting the
  # sources: noto.c has matching #if tests, and a mismatch is either a link
  # error or a font compiled in that nothing can reach.
  list(APPEND MUPDF_FONT_DEFS TOFU_CJK TOFU_NOTO TOFU_SIL)
elseif(NITROFLIPPER_MUPDF_FONTS STREQUAL "no-cjk")
  mupdf_generate_fonts(sil cff MUPDF_FONT_SIL)
  mupdf_generate_fonts(noto otf MUPDF_FONT_NOTO_OTF)
  mupdf_generate_fonts(noto ttf MUPDF_FONT_NOTO_TTF)
  set(MUPDF_FONT_NOTO ${MUPDF_FONT_NOTO_OTF} ${MUPDF_FONT_NOTO_TTF})
  # TOFU_CJK implies TOFU_CJK_EXT and TOFU_CJK_LANG, and drops both han and
  # droid -- matching the two families not generated.
  list(APPEND MUPDF_FONT_DEFS TOFU_CJK)
elseif(NITROFLIPPER_MUPDF_FONTS STREQUAL "full")
  mupdf_generate_fonts(sil cff MUPDF_FONT_SIL)
  mupdf_generate_fonts(noto otf MUPDF_FONT_NOTO_OTF)
  mupdf_generate_fonts(noto ttf MUPDF_FONT_NOTO_TTF)
  set(MUPDF_FONT_NOTO ${MUPDF_FONT_NOTO_OTF} ${MUPDF_FONT_NOTO_TTF})
  mupdf_generate_fonts(droid ttf MUPDF_FONT_DROID)
  mupdf_generate_fonts(han ttc MUPDF_FONT_HAN)
else()
  message(FATAL_ERROR
    "NITROFLIPPER_MUPDF_FONTS must be full, no-cjk or minimal "
    "(got '${NITROFLIPPER_MUPDF_FONTS}')")
endif()

set(MUPDF_FONT_SRC
  ${MUPDF_FONT_URW} ${MUPDF_FONT_SIL} ${MUPDF_FONT_NOTO}
  ${MUPDF_FONT_DROID} ${MUPDF_FONT_HAN}
)

list(LENGTH MUPDF_FONT_SRC MUPDF_FONT_COUNT)
message(STATUS
  "MuPDF fonts: ${NITROFLIPPER_MUPDF_FONTS} (${MUPDF_FONT_COUNT} embedded files)")

file(GLOB MUPDF_HYPHEN_SRC CONFIGURE_DEPENDS "${MUPDF_DIR}/generated/resources/hyphen/*.c")

file(GLOB MUPDF_FITZ_SRC CONFIGURE_DEPENDS "${MUPDF_DIR}/source/fitz/*.c")
file(GLOB MUPDF_PDF_SRC CONFIGURE_DEPENDS "${MUPDF_DIR}/source/pdf/*.c")
file(GLOB MUPDF_HTML_SRC CONFIGURE_DEPENDS "${MUPDF_DIR}/source/html/*.c")
file(GLOB MUPDF_CBZ_SRC CONFIGURE_DEPENDS "${MUPDF_DIR}/source/cbz/*.c")
file(GLOB MUPDF_REFLOW_SRC CONFIGURE_DEPENDS "${MUPDF_DIR}/source/reflow/*.c")

add_library(mupdf STATIC
  ${MUPDF_FITZ_SRC}
  ${MUPDF_PDF_SRC}
  ${MUPDF_HTML_SRC}
  ${MUPDF_CBZ_SRC}
  ${MUPDF_REFLOW_SRC}
  ${MUPDF_FONT_SRC}
  ${MUPDF_HYPHEN_SRC}
)

# The font arrays are megabytes of initialised data; optimising them is pure
# build time for no gain.
set_source_files_properties(${MUPDF_FONT_SRC} ${MUPDF_HYPHEN_SRC}
  PROPERTIES COMPILE_OPTIONS "-O0;-w")

target_include_directories(mupdf PUBLIC "${MUPDF_DIR}/include")
target_include_directories(mupdf PRIVATE
  "${MUPDF_DIR}/source"
  # fitz includes jpeglib.h directly (filter-dct.c), and that pulls in the
  # jconfig.h MuPDF keeps under scripts/ rather than with the library.
  "${MUPDF_DIR}/scripts/freetype"
  "${MUPDF_DIR}/scripts/libjpeg"
)
target_link_libraries(mupdf PUBLIC mupdf_thirdparty)
# The TOFU defines are PUBLIC because noto.c's #if tests must see the same
# values as any consumer that asks fitz which fonts exist.
target_compile_definitions(mupdf PUBLIC ${MUPDF_FEATURE_DEFS} ${MUPDF_FONT_DEFS})

find_package(Threads REQUIRED)
target_link_libraries(mupdf PUBLIC Threads::Threads)
if(NOT ANDROID AND NOT APPLE)
  target_link_libraries(mupdf PUBLIC m)
endif()

set(MUPDF_DIR "${MUPDF_DIR}" PARENT_SCOPE)
