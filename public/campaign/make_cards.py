"""
Mukoko News campaign cards.

Brand rules this follows, from CLAUDE.md's design doctrine:
  · ground is `--container-tanzanite` #1A0033, the deep tanzanite the app icon
    already sits on, and body text is `--on-container-tanzanite` #EDE0F3 — a
    pair the token table has already measured at APCA Lc 89.8, so nothing here
    is a fresh contrast guess
  · the seven minerals appear in the stripe, in ring order, at their DARK
    values, because the card is a dark surface
  · the wordmark is Noto Serif, lowercase, always "mukoko" — never capitalised
  · one figure per card. A card that carries two numbers carries neither.

Every number is measured from the live corpus (2026-09-11) — see the campaign
brief. Nothing here is rounded up.
"""

from PIL import Image, ImageDraw, ImageFont

SIZE = 1080
GROUND = "#1A0033"          # --container-tanzanite
INK = "#EDE0F3"             # --on-container-tanzanite (Lc 89.8 on the ground)
WHITE = "#FFFFFF"
TANZANITE = "#B388FF"       # dark-mode mineral values: this is a dark surface
MINERALS = ["#00B0FF", "#B388FF", "#64FFDA", "#FFD740", "#E1B07E", "#3D5AFE", "#FF8A65"]

SERIF = "fonts/NotoSerif.ttf"
SANS = (
    "/tmp/claude-0/-home-user/c4d3311f-c9e9-5157-b3de-146fc7130f19/scratchpad/mock/"
    "news-page-redesign-request/project/_ds/"
    "nyuchi-design-system-51ffb6f7-f22e-504b-b23c-6e3eb53b08f2/fonts/"
    "NotoSans-VariableFont_wdth_wght.ttf"
)

MARGIN = 88
STRIPE = 16  # the minerals stripe, down the right edge as it is in the app


def font(path: str, size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_axes([weight] if "NotoSerif" in path else [100, weight])
    except Exception:
        pass
    return f


def base() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    """A card with its ground and the seven-mineral stripe already drawn."""
    img = Image.new("RGB", (SIZE, SIZE), GROUND)
    d = ImageDraw.Draw(img)
    band = SIZE / len(MINERALS)
    for i, colour in enumerate(MINERALS):
        d.rectangle(
            [SIZE - STRIPE, round(i * band), SIZE, round((i + 1) * band)], fill=colour
        )
    return img, d


def wordmark(d: ImageDraw.ImageDraw, y: int = MARGIN) -> None:
    d.text((MARGIN, y), "mukoko news", font=font(SERIF, 40, 600), fill=TANZANITE)


def footer(d: ImageDraw.ImageDraw, text: str = "news.mukoko.com/insights") -> None:
    d.text(
        (MARGIN, SIZE - MARGIN - 30), text, font=font(SANS, 30, 500), fill=INK
    )


def wrap(d, text, f, width):
    """Greedy wrap to a pixel width — the strings here are short and known."""
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if d.textlength(trial, font=f) <= width:
            line = trial
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines



def draw_block(d, x, y, lines):
    """
    Stack lines from a real TOP edge, using each glyph run's measured bounding
    box rather than PIL's ascender origin.

    PIL's `text()` y is the top of the font's box, not of the ink, and Noto
    Serif at display sizes carries a lot of air above the cap and below the
    baseline. Positioning by that box is what put the caption through the
    comma of "65,204" in the first render. Each entry is
    (text, font, fill, gap_after).
    """
    cursor = y
    for text, f, fill, gap in lines:
        box = d.textbbox((0, 0), text, font=f)
        d.text((x, cursor - box[1]), text, font=f, fill=fill)
        cursor += (box[3] - box[1]) + gap
    return cursor


def card_corpus(path):
    img, d = base()
    wordmark(d)
    draw_block(
        d,
        MARGIN,
        330,
        [
            ("65,204", font(SERIF, 200, 700), WHITE, 54),
            ("articles, from 537 African", font(SANS, 46, 400), INK, 16),
            ("newsrooms in 43 countries", font(SANS, 46, 400), INK, 54),
            ("growing by ~1,600 a day", font(SANS, 34, 400), TANZANITE, 0),
        ],
    )
    footer(d)
    img.save(path, "PNG")


def card_countries(path):
    img, d = base()
    wordmark(d)
    draw_block(
        d,
        MARGIN,
        200,
        [
            ("Where it comes from", font(SERIF, 58, 600), WHITE, 22),
            ("articles published in the last 30 days", font(SANS, 30, 400), TANZANITE, 0),
        ],
    )

    rows = [
        ("Nigeria", 11309),
        ("South Africa", 5814),
        ("Zimbabwe", 3660),
        ("Ghana", 3519),
        ("Senegal", 3006),
        ("Kenya", 2396),
    ]
    top = max(v for _, v in rows)
    bar_x, bar_w = MARGIN, SIZE - MARGIN * 2 - STRIPE
    y = 330
    for i, (name, value) in enumerate(rows):
        d.text((bar_x, y), name, font=font(SANS, 34, 500), fill=INK)
        label = f"{value:,}"
        d.text(
            (bar_x + bar_w - d.textlength(label, font=font(SANS, 34, 600)), y),
            label,
            font=font(SANS, 34, 600),
            fill=WHITE,
        )
        d.rectangle([bar_x, y + 48, bar_x + bar_w, y + 58], fill="#2E1A4A")
        d.rectangle(
            [bar_x, y + 48, bar_x + round(bar_w * value / top), y + 58],
            fill=MINERALS[i % len(MINERALS)],
        )
        y += 100
    footer(d)
    img.save(path, "PNG")


def card_gap(path):
    img, d = base()
    wordmark(d)

    big = font(SERIF, 220, 700)
    box = d.textbbox((0, 0), "43", font=big)
    d.text((MARGIN, 330 - box[1]), "43", font=big, fill=WHITE)
    sub = font(SERIF, 100, 400)
    sbox = d.textbbox((0, 0), "of 54", font=sub)
    # Sit "of 54" on the same baseline as the 43, not on the same top edge.
    d.text(
        (MARGIN + (box[2] - box[0]) + 28, 330 + (box[3] - box[1]) - (sbox[3] - sbox[1]) - sbox[1]),
        "of 54",
        font=sub,
        fill=TANZANITE,
    )

    draw_block(
        d,
        MARGIN,
        560,
        [
            ("African Union member states", font(SANS, 44, 400), INK, 16),
            ("produce into the corpus.", font(SANS, 44, 400), INK, 60),
            ("The other eleven are the work,", font(SANS, 34, 400), TANZANITE, 14),
            ("not a rounding error.", font(SANS, 34, 400), TANZANITE, 0),
        ],
    )
    footer(d)
    img.save(path, "PNG")


def card_open(path):
    img, d = base()
    wordmark(d)
    inner = SIZE - MARGIN * 2 - STRIPE

    cursor = draw_block(
        d,
        MARGIN,
        300,
        [
            ("Open data.", font(SERIF, 92, 700), WHITE, 26),
            ("No login.", font(SERIF, 92, 700), WHITE, 62),
        ],
    )

    body = (
        "Every figure we publish is downloadable as JSON or CSV. "
        "If our numbers are wrong, we would rather hear it from "
        "someone holding the file."
    )
    fb = font(SANS, 38, 400)
    draw_block(d, MARGIN, cursor, [(line, fb, INK, 16) for line in wrap(d, body, fb, inner)])
    footer(d)
    img.save(path, "PNG")


if __name__ == "__main__":
    card_corpus("card-1-corpus.png")
    card_countries("card-2-countries.png")
    card_gap("card-3-gap.png")
    card_open("card-4-open.png")
    print("4 cards written")
