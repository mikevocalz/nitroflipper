#!/usr/bin/env python3
"""Generate the edge-case document fixtures the engine tests need.

Regenerate with:

    python3 fixtures/generate_edge_cases.py

Outputs under fixtures/output/:

  reflow.epub     Reflowable EPUB 3, six spine items, ~4500 generated words.
                  Laying it out at 12pt and at 24pt in the same box must give
                  materially different page counts -- that is the whole point
                  of the fixture. comic.epub cannot do this job: it is
                  pre-paginated, one image per spine item, so its page count is
                  the same at every font size and every repagination assertion
                  against it is vacuous.
  rtl.epub        Reflowable, spine page-progression-direction="rtl", Arabic
                  body text with a Hebrew chapter. MuPDF 1.28.4 does not read
                  page-progression-direction at all (grep the tree: the string
                  appears nowhere in source/), so this fixture exists to prove
                  the engine opens and renders RTL content, not to prove
                  direction handling that does not exist yet.
  mixed.pdf       Four pages at three different sizes: A4 portrait, A5
                  landscape, a double-width spread, A4 portrait again. Guards
                  any code that caches one page box and reuses it.
  locked.pdf      RC4-128 encrypted, user password "open-sesame", owner
                  password "owner-sesame".
  malformed.pdf   A real PDF truncated before its first indirect object, with
                  a garbage tail. MuPDF's repair pass finds nothing to rebuild
                  from and raises "no objects found", which the engine reports
                  as ErrorKind::Malformed. See build_malformed_pdf for why the
                  cut goes there and not further in.

Everything here is generated at run time from a seeded PRNG plus shapes drawn
by reportlab. There is no third-party prose, no sample book, and no downloaded
asset -- nothing in the output carries anyone's copyright. The Latin-looking
words are invented syllable pairs, and the Arabic and Hebrew words are built
the same way from their alphabets, so they are pronounceable-looking nonsense
rather than quoted text.

Requires: pillow, reportlab (both already used by generate_comic.py).
"""

import random
import zipfile
from pathlib import Path

from reportlab.lib import pdfencrypt
from reportlab.lib.pagesizes import A4, A5, landscape
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "output"
OUT.mkdir(exist_ok=True)

# One seed for every fixture, so a regeneration is byte-stable apart from the
# PDF timestamps reportlab writes.
SEED = 0x4E464C31  # "NFL1"

LOCKED_USER_PASSWORD = "open-sesame"
LOCKED_OWNER_PASSWORD = "owner-sesame"

# --- Generated vocabularies ---------------------------------------------------

LATIN_ONSETS = "b d f g k l m n p r s t v br cr dr fr gr pr tr bl cl fl gl pl sl st sp".split()
LATIN_NUCLEI = "a e i o u ae ea io ou ei au".split()
LATIN_CODAS = "n r s l m t d nt rt st ld nd rs ns".split()

# Arabic letters that join normally, so the shaper has real work to do.
ARABIC_LETTERS = "بتثجحخسشصضطظعغفقكلمنهي"
# Hebrew consonants, no final forms (they would need position-aware selection).
HEBREW_LETTERS = "אבגדהוזחטיכלמנספצקרשת"


def latin_word(rng: random.Random) -> str:
    syllables = rng.randint(1, 3)
    word = ""
    for _ in range(syllables):
        word += rng.choice(LATIN_ONSETS) + rng.choice(LATIN_NUCLEI)
        if rng.random() < 0.4:
            word += rng.choice(LATIN_CODAS)
    return word


def script_word(rng: random.Random, alphabet: str) -> str:
    return "".join(rng.choice(alphabet) for _ in range(rng.randint(2, 6)))


def sentence(rng: random.Random, make_word, *, terminator: str = ".") -> str:
    words = [make_word(rng) for _ in range(rng.randint(6, 16))]
    words[0] = words[0][0].upper() + words[0][1:] if words[0].isascii() else words[0]
    body = " ".join(words)
    if rng.random() < 0.18:
        # A comma or two, so line breaking has something other than spaces.
        pieces = body.split(" ")
        cut = rng.randint(2, max(2, len(pieces) - 2))
        body = " ".join(pieces[:cut]) + ", " + " ".join(pieces[cut:])
    return body + terminator


def paragraph(rng: random.Random, make_word, *, terminator: str = ".") -> str:
    return " ".join(
        sentence(rng, make_word, terminator=terminator)
        for _ in range(rng.randint(3, 7))
    )


def word_count(chapters) -> int:
    return sum(len(p.split()) for _, paras in chapters for p in paras)


# --- EPUB writing -------------------------------------------------------------


def xhtml_chapter(title: str, paragraphs, *, lang: str, rtl: bool) -> str:
    direction = ' dir="rtl"' if rtl else ""
    body = "\n".join(f"  <p>{p}</p>" for p in paragraphs)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="{lang}" lang="{lang}"{direction}>
<head>
  <meta charset="utf-8"/>
  <title>{title}</title>
  <link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body{direction}>
  <h1>{title}</h1>
{body}
</body>
</html>"""


def write_epub(
    path: Path,
    *,
    title: str,
    identifier: str,
    language: str,
    chapters,
    rtl: bool = False,
) -> None:
    """Write a reflowable EPUB 3. No rendition:layout, so it stays reflowable."""
    manifest = [
        '<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="css" href="style.css" media-type="text/css"/>',
    ]
    spine = []
    documents = []

    for index, (chapter_title, paragraphs) in enumerate(chapters):
        item_id = f"ch{index:02d}"
        href = f"text/{item_id}.xhtml"
        manifest.append(
            f'<item id="{item_id}" href="{href}" media-type="application/xhtml+xml"/>'
        )
        spine.append(f'<itemref idref="{item_id}"/>')
        documents.append(
            (href, xhtml_chapter(chapter_title, paragraphs, lang=language, rtl=rtl))
        )

    progression = ' page-progression-direction="rtl"' if rtl else ""
    manifest_xml = "\n    ".join(manifest)
    spine_xml = "\n    ".join(spine)

    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">{identifier}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:language>{language}</dc:language>
  </metadata>
  <manifest>
    {manifest_xml}
  </manifest>
  <spine{progression}>
    {spine_xml}
  </spine>
</package>"""

    toc_entries = "\n      ".join(
        f'<li><a href="text/ch{index:02d}.xhtml">{chapter_title}</a></li>'
        for index, (chapter_title, _) in enumerate(chapters)
    )
    toc = f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>{title}</title></head>
<body>
<nav epub:type="toc" id="toc">
  <h1>{title}</h1>
  <ol>
      {toc_entries}
  </ol>
</nav>
</body>
</html>"""

    # No font sizes here: the test varies em through fz_layout_document, and a
    # stylesheet that pinned px sizes would make the font-size argument inert.
    css = """body { margin: 0 1em; }
h1 { page-break-before: always; }
p { margin: 0 0 0.6em 0; text-align: justify; }
"""

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        # mimetype must be the first entry and stored uncompressed.
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>""",
        )
        zf.writestr("OPS/content.opf", opf)
        zf.writestr("OPS/toc.xhtml", toc)
        zf.writestr("OPS/style.css", css)
        for href, document in documents:
            zf.writestr(f"OPS/{href}", document)


def build_reflow_epub(path: Path) -> int:
    rng = random.Random(SEED)
    chapters = []
    for index in range(6):
        # The heading carries a unique marker so a test can prove which chapter
        # a locator landed in by reading the page text.
        title = f"Chapter {index + 1} Marker CH{index + 1:02d}"
        paragraphs = [paragraph(rng, latin_word) for _ in range(14)]
        chapters.append((title, paragraphs))

    write_epub(
        path,
        title="Reflow Test Volume",
        identifier="urn:nitro-flipper:reflow-test",
        language="en",
        chapters=chapters,
    )
    return word_count(chapters)


def build_rtl_epub(path: Path) -> int:
    rng = random.Random(SEED + 1)
    chapters = []
    for index in range(3):
        alphabet = ARABIC_LETTERS if index < 2 else HEBREW_LETTERS
        # Arabic full stop for the Arabic chapters, plain stop for the Hebrew.
        terminator = "۔" if index < 2 else "."
        title = script_word(rng, alphabet) + " " + script_word(rng, alphabet)
        paragraphs = [
            paragraph(rng, lambda r: script_word(r, alphabet), terminator=terminator)
            for _ in range(10)
        ]
        chapters.append((title, paragraphs))

    write_epub(
        path,
        title="RTL Test Volume",
        identifier="urn:nitro-flipper:rtl-test",
        language="ar",
        chapters=chapters,
        rtl=True,
    )
    return word_count(chapters)


# --- PDF writing --------------------------------------------------------------

DOUBLE_WIDE = (A4[0] * 2, A4[1])
A5_LANDSCAPE = landscape(A5)

MIXED_PAGES = [
    ("A4 portrait", A4),
    ("A5 landscape", A5_LANDSCAPE),
    ("double width spread", DOUBLE_WIDE),
    ("A4 portrait again", A4),
]


def draw_placard(c: canvas.Canvas, label: str, size) -> None:
    width, height = size
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(2)
    c.rect(24, 24, width - 48, height - 48)
    # Corner ticks make a wrong-aspect render obvious by eye in a failure dump.
    for x, y in ((24, 24), (width - 24, 24), (24, height - 24), (width - 24, height - 24)):
        c.line(x - 12, y, x + 12, y)
        c.line(x, y - 12, x, y + 12)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(48, height - 80, label)
    c.setFont("Helvetica", 14)
    c.drawString(48, height - 108, f"{width:.0f} x {height:.0f} pt")
    c.drawString(48, height - 130, f"aspect {width / height:.4f}")


def build_mixed_pdf(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=MIXED_PAGES[0][1])
    for label, size in MIXED_PAGES:
        c.setPageSize(size)
        draw_placard(c, label, size)
        c.showPage()
    c.save()


def build_locked_pdf(path: Path) -> None:
    encryption = pdfencrypt.StandardEncryption(
        userPassword=LOCKED_USER_PASSWORD,
        ownerPassword=LOCKED_OWNER_PASSWORD,
        canPrint=1,
        canModify=0,
        canCopy=0,
        canAnnotate=0,
        strength=128,
    )
    c = canvas.Canvas(str(path), pagesize=A4, encrypt=encryption)
    for index in range(3):
        draw_placard(c, f"Locked page {index + 1}", A4)
        c.setFont("Helvetica", 16)
        c.drawString(48, 200, "This page is only readable after authenticate().")
        c.showPage()
    c.save()


def build_malformed_pdf(path: Path, source: Path) -> None:
    """A PDF whose download died right after the header.

    Where to cut is the whole design of this fixture, and it was chosen by
    measurement rather than by guessing:

      * Cutting at 1800 of mixed.pdf's 3648 bytes still yields a *readable
        4-page document*. MuPDF's repair pass rebuilds the page tree from the
        surviving objects, so a half-file is not a malformed file.
      * Cutting mid-object and appending a dangling "7 0 obj << /Type /Page"
        is worse than useless: MuPDF then opens the file and reports
        pageCount() == 0. A reader would show a blank document instead of an
        error.

    Cutting before the first indirect object leaves repair nothing to latch on
    to, so it raises FZ_ERROR_FORMAT "no objects found", which FzGuard's
    classify() maps to ErrorKind::Malformed. The garbage tail is there so the
    file is a plausible truncated download rather than a bare header; it is
    drawn from the same seeded PRNG and deliberately contains no "obj".
    """
    data = source.read_bytes()
    # Everything up to and including the line before the first "N 0 obj".
    head = data[: data.rindex(b"\n", 0, data.index(b" 0 obj")) + 1]

    rng = random.Random(SEED + 2)
    tail = bytes(rng.randrange(0x20, 0x7F) for _ in range(512))
    assert b"obj" not in tail, "the garbage tail must not look like an object"

    path.write_bytes(head + tail)


def main() -> None:
    reflow_words = build_reflow_epub(OUT / "reflow.epub")
    rtl_words = build_rtl_epub(OUT / "rtl.epub")
    build_mixed_pdf(OUT / "mixed.pdf")
    build_locked_pdf(OUT / "locked.pdf")
    build_malformed_pdf(OUT / "malformed.pdf", OUT / "mixed.pdf")

    for name, note in [
        ("reflow.epub", f"{reflow_words} words, 6 spine items"),
        ("rtl.epub", f"{rtl_words} words, 3 spine items, ppd=rtl"),
        ("mixed.pdf", f"{len(MIXED_PAGES)} pages, 3 distinct sizes"),
        ("locked.pdf", f'user password "{LOCKED_USER_PASSWORD}"'),
        ("malformed.pdf", "header only, no recoverable objects"),
    ]:
        size = (OUT / name).stat().st_size
        print(f"{name:16} {size:>8} bytes  {note}")


if __name__ == "__main__":
    main()
