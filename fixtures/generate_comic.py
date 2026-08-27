#!/usr/bin/env python3
"""Generate a small, deterministic synthetic comic archive for testing.

Outputs under fixtures/output/:
  - ltr.cbz / rtl.cbz   (CBZ with optional ComicInfo.xml)
  - comic.pdf           (multi-page PDF from the same raster pages)
  - comic.epub          (fixed-layout EPUB from the same raster pages)

The comic intentionally exercises the page-pairing logic:
  * cover with a different trim/aspect ratio
  * interior pages in normal reading order
  * one double-page spread (wide image)
  * one LTR and one RTL variant
"""

import io
import math
import os
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "output"
OUT.mkdir(exist_ok=True)


def screentone(width: int, height: int, dot_spacing: int = 12) -> Image.Image:
    """Return a grey screentone background."""
    img = Image.new("RGB", (width, height), (220, 220, 220))
    draw = ImageDraw.Draw(img)
    for y in range(0, height, dot_spacing):
        for x in range(0, width, dot_spacing):
            offset = (y // dot_spacing) % 2 * (dot_spacing // 2)
            draw.ellipse(
                [x + offset, y, x + offset + 4, y + 4],
                fill=(160, 160, 160),
            )
    return img


def draw_page(
    label: str,
    width: int,
    height: int,
    *,
    rtl: bool = False,
    double: bool = False,
    cover: bool = False,
) -> Image.Image:
    """Draw a page/spread with panel-like boxes and tiny lettering."""
    img = screentone(width, height)
    draw = ImageDraw.Draw(img)

    # Border / trim hint
    margin = 20 if not cover else 30
    draw.rectangle([margin, margin, width - margin, height - margin], outline="black", width=3)

    # A few panel boxes
    panels = [
        [margin + 10, margin + 10, width // 2 - 10, height // 2 - 10],
        [width // 2 + 10, margin + 10, width - margin - 10, height // 2 - 10],
        [margin + 10, height // 2 + 10, width - margin - 10, height - margin - 10],
    ] if not double else [
        [margin + 10, margin + 10, width // 4 - 10, height // 2 - 10],
        [width // 4 + 10, margin + 10, width // 2 - 10, height // 2 - 10],
        [width // 2 + 10, margin + 10, 3 * width // 4 - 10, height // 2 - 10],
        [3 * width // 4 + 10, margin + 10, width - margin - 10, height // 2 - 10],
        [margin + 10, height // 2 + 10, width - margin - 10, height - margin - 10],
    ]

    for box in panels:
        draw.rectangle(box, outline="black", width=2)

    # 6pt-ish label in the bottom-left corner
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
    except Exception:
        font = ImageFont.load_default()

    text = f"{label} {'RTL' if rtl else 'LTR'}"
    draw.text((margin + 14, height - margin - 40), text, fill="black", font=font)
    return img


def make_pages(rtl: bool):
    pages = []
    # Cover has a slightly different trim/aspect.
    pages.append(("cover", draw_page("cover", 400, 600, cover=True, rtl=rtl)))
    pages.append(("page01", draw_page("01", 400, 600, rtl=rtl)))
    pages.append(("page02", draw_page("02", 400, 600, rtl=rtl)))
    # Double-page spread
    pages.append(("spread", draw_page("spread", 800, 600, double=True, rtl=rtl)))
    pages.append(("page03", draw_page("03", 400, 600, rtl=rtl)))
    pages.append(("page04", draw_page("04", 400, 600, rtl=rtl)))
    return pages


def save_jpeg(img: Image.Image, path: Path) -> None:
    img.save(path, format="JPEG", quality=85)


def build_cbz(pages, path: Path, rtl: bool):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        comic_info = """<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:xsd="http://www.w3.org/2001/XMLSchema/tns">
  <Title>Synthetic Test Comic</Title>
  <Manga>{}</Manga>
  <Pages>
""".format("YesAndRightToLeft" if rtl else "Yes")
        page_types = ["FrontCover"] + ["Story"] * (len(pages) - 1)
        # Mark the wide entry as a double-page spread in metadata.
        for idx, (name, img, _) in enumerate(pages):
            double = name == "spread"
            width, height = img.size
            comic_info += (
                f'    <Page Image="{name}.jpg" ImageWidth="{width}" '
                f'ImageHeight="{height}" Type="{page_types[idx]}" '
                f'DoublePage="{"true" if double else "false"}"/>\n'
            )
        comic_info += "  </Pages>\n</ComicInfo>\n"
        zf.writestr("ComicInfo.xml", comic_info)

        for name, _, img_path in pages:
            zf.write(img_path, f"{name}.jpg")


def build_pdf(pages, path: Path):
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas
    except ImportError as e:
        raise RuntimeError("reportlab is required to generate PDF fixtures") from e

    # Use the first page's aspect to set a custom page size; reportlab uses points.
    first_w, first_h = pages[0][1].size
    page_w_pt = first_w * 72 / 150  # assume 150 dpi
    page_h_pt = first_h * 72 / 150

    c = canvas.Canvas(str(path), pagesize=(page_w_pt, page_h_pt))
    for name, _, img_path in pages:
        img = Image.open(img_path)
        w, h = img.size
        # Fit each raster page to the PDF page while preserving aspect.
        scale = min(page_w_pt / w, page_h_pt / h)
        nw, nh = w * scale, h * scale
        x, y = (page_w_pt - nw) / 2, (page_h_pt - nh) / 2
        c.drawImage(str(img_path), x, y, width=nw, height=nh)
        c.showPage()
    c.save()


def build_epub(pages, path: Path):
    # A minimal fixed-layout EPUB 3 package.
    opf_ns = "http://www.idpf.org/2007/opf"
    dc_ns = "http://purl.org/dc/elements/1.1/"
    xhtml_ns = "http://www.w3.org/1999/xhtml"

    manifest_items = []
    spine_items = []
    xhtml_entries = []

    for idx, (name, img, img_path) in enumerate(pages):
        w, h = img.size
        item_id = f"page{idx:03d}"
        img_name = f"images/{name}.jpg"
        xhtml_name = f"text/{item_id}.xhtml"
        manifest_items.append(
            f'<item id="{item_id}" href="{xhtml_name}" media-type="application/xhtml+xml"/>'
        )
        manifest_items.append(
            f'<item id="img{idx:03d}" href="{img_name}" media-type="image/jpeg"/>'
        )
        spine_items.append(f'<itemref idref="{item_id}"/>')

        xhtml = f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="{xhtml_ns}" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width={w}, height={h}"/>
  <style>
    body {{ margin: 0; padding: 0; }}
    img {{ width: 100%; height: 100%; object-fit: contain; }}
  </style>
</head>
<body>
  <img src="../{img_name}" alt="Page {idx + 1}"/>
</body>
</html>"""
        with open(img_path, "rb") as f:
            img_bytes = f.read()
        xhtml_entries.append((xhtml_name, xhtml, img_name, img_bytes))

    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="{opf_ns}" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="{dc_ns}">
    <dc:identifier id="id">urn:nitro-flipper:synthetic-comic</dc:identifier>
    <dc:title>Synthetic Test Comic</dc:title>
    <dc:language>en</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">both</meta>
  </metadata>
  <manifest>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    {"\n    ".join(manifest_items)}
  </manifest>
  <spine>
    {"\n    ".join(spine_items)}
  </spine>
</package>"""

    toc = f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>TOC</title></head>
<body>
<nav epub:type="toc">
  <ol>
    {"\n    ".join([f'<li><a href="text/page{idx:03d}.xhtml">Page {idx + 1}</a></li>' for idx in range(len(pages))])}
  </ol>
</nav>
</body>
</html>"""

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        # EPUB mimetype must be first and uncompressed.
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr("META-INF/container.xml", """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>""")
        zf.writestr("OPS/content.opf", opf)
        zf.writestr("OPS/toc.xhtml", toc)
        for xhtml_name, xhtml, img_name, img_bytes in xhtml_entries:
            zf.writestr(f"OPS/{xhtml_name}", xhtml)
            zf.writestr(f"OPS/{img_name}", img_bytes)


def main():
    pages_dir = OUT / "pages"
    pages_dir.mkdir(exist_ok=True)

    for rtl, suffix in [(False, "ltr"), (True, "rtl")]:
        raw_pages = make_pages(rtl)
        pages = []
        for idx, (name, img) in enumerate(raw_pages):
            img_path = pages_dir / f"{suffix}_{name}.jpg"
            save_jpeg(img, img_path)
            pages.append((name, img, img_path))
        build_cbz(pages, OUT / f"{suffix}.cbz", rtl)
        if not rtl:
            # PDF/EPUB are layout-format fixtures; one copy is enough.
            build_pdf(pages, OUT / "comic.pdf")
            build_epub(pages, OUT / "comic.epub")

    print(f"Fixtures written to {OUT.resolve()}")


if __name__ == "__main__":
    main()
