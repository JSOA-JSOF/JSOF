"""Build the printable poster for an event photo drop.

    python3 scripts/make-poster.py <code> <out.pdf>

Reads the drop out of src/lib/drop/config.ts so the URL on the poster and
the URL the Worker serves cannot drift apart. Generates the QR with
scripts/make-qr.swift, which uses the generator built into macOS, so the
drop code never leaves the machine.

US Letter, and white, because this gets printed on whatever is in the
clubhouse. A black poster is handsome on a screen and a toner cartridge on
paper, and the QR has to sit on white regardless.
"""

import datetime
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
GOLD = HexColor("#9A7B22")      # darkened from the screen gold, which is illegible on paper
INK = HexColor("#111111")
MUTE = HexColor("#5A554B")
RULE = HexColor("#C9C3B4")


def read_drop(code: str) -> dict:
    source = (ROOT / "src/lib/drop/config.ts").read_text()
    block = re.search(r"\{[^{}]*code:\s*\"" + re.escape(code) + r"\"[^{}]*\}", source)
    if not block:
        sys.exit(f"no drop with code {code} in src/lib/drop/config.ts")
    fields = dict(re.findall(r'(\w+):\s*"([^"]*)"', block.group(0)))
    return fields


def qr_png(url: str, into: Path) -> Path:
    out = into / "qr.png"
    subprocess.run(
        ["swift", str(ROOT / "scripts/make-qr.swift"), url, str(out), "2048"],
        check=True,
        capture_output=True,
    )
    return out


def centred(c, text, y, font, size, colour, tracking=0.0):
    """Centred text, with optional letter spacing.

    reportlab's canvas has no character-space setter, so spaced text is
    drawn a glyph at a time from a measured start. Worth the few lines:
    the tracked small caps are what stop this reading like a memo.
    """
    c.setFont(font, size)
    c.setFillColor(colour)
    page_width, _ = letter
    if not tracking:
        c.drawCentredString(page_width / 2, y, text)
        return
    run = c.stringWidth(text, font, size) + tracking * (len(text) - 1)
    x = (page_width - run) / 2
    for glyph in text:
        c.drawString(x, y, glyph)
        x += c.stringWidth(glyph, font, size) + tracking


def build(code: str, out: Path) -> None:
    drop = read_drop(code)
    url = f"https://thejsof.org/drop/{code}"
    width, height = letter

    with tempfile.TemporaryDirectory() as tmp:
        qr = qr_png(url, Path(tmp))

        c = canvas.Canvas(str(out), pagesize=letter)
        c.setTitle(f"{drop['event']} - send us your photos")
        c.setAuthor("Joint Special Operations Association")

        c.setFillColor(white)
        c.rect(0, 0, width, height, stroke=0, fill=1)

        # A gold band across the head, which is the only ink-heavy thing on
        # the page and reads from across a room.
        c.setFillColor(GOLD)
        c.rect(0, height - 92, width, 92, stroke=0, fill=1)
        centred(c, "JOINT SPECIAL OPERATIONS ASSOCIATION", height - 58, "Helvetica-Bold", 13, white, 2.6)

        centred(c, drop["event"].upper(), height - 160, "Helvetica-Bold", 40, INK, 0.5)
        centred(c, drop["where"], height - 186, "Helvetica", 13, MUTE)

        c.setStrokeColor(RULE)
        c.setLineWidth(0.8)
        c.line(150, height - 212, width - 150, height - 212)

        centred(c, "SEND US YOUR PHOTOS", height - 252, "Helvetica-Bold", 25, INK, 1.2)
        centred(c, "Point your phone camera at the code.", height - 278, "Helvetica", 14, MUTE)

        # Laid out from a cursor running down the page rather than from
        # magic numbers, because the last version put the closing date on
        # top of the small print and nothing in the code said why.
        side = 272
        x = (width - side) / 2
        cursor = height - 300 - side
        # A hairline keeps the code looking deliberate rather than pasted on.
        c.setStrokeColor(RULE)
        c.rect(x - 14, cursor - 14, side + 28, side + 28, stroke=1, fill=0)
        c.drawImage(ImageReader(str(qr)), x, cursor, side, side, mask=None)

        cursor -= 46
        centred(c, url, cursor, "Helvetica-Bold", 13, GOLD)

        cursor -= 30
        c.setStrokeColor(RULE)
        c.line(150, cursor, width - 150, cursor)

        cursor -= 28
        for line in [
            "No app. No account. No sign-in.",
            "Send as many photos as you like. There is no limit on how many.",
            "They go to the board, and nothing is published without asking you first.",
        ]:
            centred(c, line, cursor, "Helvetica", 12, MUTE)
            cursor -= 19

        closes = datetime.date.fromisoformat(drop["closesAt"])
        centred(
            c,
            f"Closes {closes.day} {closes.strftime('%B %Y')}",
            cursor - 12,
            "Helvetica",
            11,
            Color(0.45, 0.43, 0.39),
        )

        c.showPage()
        c.save()
    print(f"wrote {out}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: make-poster.py <code> <out.pdf>")
    build(sys.argv[1], Path(sys.argv[2]))
