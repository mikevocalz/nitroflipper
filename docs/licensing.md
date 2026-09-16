# Licensing

Read this before shipping anything built from this branch.

## The short version

`nitro-flipper` declares MIT in `package.json`. MuPDF does not. Adding MuPDF to
this package does not relicense MuPDF, and NitroFlipper's MIT notice has no
power to grant you rights to it.

MuPDF is dual-licensed by Artifex:

- **AGPL-3.0** — free to use, with the AGPL's obligations, or
- **a commercial licence from Artifex** — negotiated separately.

No commercial licence has been acquired for this project. Nobody working on this
repository has authority to grant you one.

## What that means for an app

The AGPL is copyleft, and section 13 extends it to network use. If you link the
MuPDF-backed document engine into an application and convey that application —
shipping it on the App Store or Google Play counts — then the AGPL's terms apply
to the combined work. In practice that means offering the corresponding source
of the whole application under the AGPL.

For most commercial apps that is not acceptable, and the answer is to buy a
commercial licence from Artifex (<https://artifex.com/licensing>) before
shipping. That is a decision for whoever owns the product, made with legal
advice. It is not a build flag.

## What this package contains

The repository does **not** vendor MuPDF source. `third_party/mupdf/CMakeLists.txt`
downloads the pinned release tarball at build time:

- version 1.28.4, released 2026-09-15
- SHA256 `2d97e043a616f96b148657c9c3d81ad71c4bd2052c59a2a3315ad842599340f9`
- upstream tag `ce933bdebe05fe54ba9d69792ed268efd9e00047`

An `npm pack` of this package therefore contains build instructions that fetch
MuPDF, not MuPDF itself. That distinction matters for what you are distributing
when you publish the package, and it does **not** help once you ship a binary:
an app binary with MuPDF linked in is a conveyed combined work regardless of how
the source arrived.

## Third-party libraries compiled into the MuPDF target

MuPDF bundles these, and our build compiles the ones listed in
`third_party/mupdf/mupdf_sources.cmake`. Their own licences survive
independently of MuPDF's:

| Library | Licence |
| --- | --- |
| FreeType | FTL or GPL-2.0 (dual) |
| HarfBuzz | MIT (Old) |
| zlib | Zlib |
| libjpeg (IJG) | IJG |
| OpenJPEG | BSD-2-Clause |
| jbig2dec | AGPL-3.0 (Artifex) |
| lcms2 (lcms2mt) | MIT |
| gumbo-parser | Apache-2.0 |
| Brotli | MIT |

Note that jbig2dec is itself Artifex AGPL, so removing MuPDF's own AGPL
obligation would not be enough on its own — it is reachable through the JBIG2
decoder that PDF needs.

Excluded from our build, and therefore not a licensing concern here: tesseract,
leptonica, zint, zxing-cpp, mujs, curl, freeglut, extract, cmark-gfm.

### Embedded fonts

The default `no-cjk` font set compiles in URW base-35 (AFPL/URW), Charis SIL
(SIL OFL 1.1) and Noto (SIL OFL 1.1). The `full` set adds Droid Sans Fallback
(Apache-2.0) and the Han CJK fonts. All retain their own licences; the OFL in
particular has naming requirements if you modify the fonts, which we do not.

## Upstream notices

`COPYING`, `CONTRIBUTORS` and the per-library notices under `thirdparty/` live in
the downloaded tarball and are preserved there. They are not stripped, rewritten
or repackaged by our build. Any binary distribution must carry them.

## References

- MuPDF licence: <https://mupdf.readthedocs.io/en/latest/license.html>
- Artifex licensing: <https://artifex.com/licensing>
- AGPL-3.0: <https://www.gnu.org/licenses/agpl-3.0.html>
