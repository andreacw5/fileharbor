"""FileHarbor brand kit generator. Usage: python gen.py <font.ttf> <outdir>"""
import os, sys, subprocess
import resvg_py
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT, OUT = sys.argv[1], sys.argv[2]
for d in ("", "png", "web", "stream-deck"):
    os.makedirs(os.path.join(OUT, d), exist_ok=True)

INK, WHITE, PERI, INDIGO = "#111111", "#ffffff", "#C7C6F5", "#3D3CA0"
NAVY_A, NAVY_B = "#0C0A14", "#191856"   # canvas of the placeholder images
TILE_A, TILE_B = "#3D3CA0", "#212079"   # Meridian service box

# ── Symbol: document with folded corner + anchor, 256 grid ─────────────
# Document 174x232 outer (3:4, as the placeholders), stroke 22, fold 72 at 45°.
DOC = "M132 23H71a19 19 0 0 0-19 19v172a19 19 0 0 0 19 19h114a19 19 0 0 0 19-19V95Z"
FOLD = "M132 23v52a20 20 0 0 0 20 20h52"

def symbol(color, small=False):
    s = 26 if small else 22
    doc = (f'<g fill="none" stroke="{color}" stroke-width="{s}" stroke-linecap="round" stroke-linejoin="round">'
           f'<path d="{DOC}"/><path d="{FOLD}"/></g>')
    if small:  # ≤32 px: ring filled, thicker anchor, wider arms
        a = (f'<circle cx="128" cy="133" r="13" fill="{color}"/>'
             f'<g fill="none" stroke="{color}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">'
             f'<path d="M128 140v48"/><path d="M100 160a28 28 0 0 0 56 0"/>'
             f'<path d="M89 170l11-11 11 11M145 170l11-11 11 11"/></g>')
    else:
        a = (f'<g fill="none" stroke="{color}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">'
             f'<circle cx="128" cy="136" r="9.5"/><path d="M128 146v40"/><path d="M102 160a26 26 0 0 0 52 0"/>'
             f'<path d="M92 170l10-10 10 10M144 170l10-10 10 10"/></g>')
    return doc + f'<g transform="translate(0 6)">{a}</g>'  # anchor sits in the lower body, under the fold

def grad(id_, a, b):
    return (f'<defs><linearGradient id="{id_}" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient></defs>')

def svg(vb, body, title="FileHarbor"):
    w, h = vb.split()[2:]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" role="img">'
            f'<title>{title}</title>{body}</svg>\n')

# ── Wordmark: Lexend Bold outlined, stacked File / Harbor (as app_logo) ──
font = TTFont(FONT)
instantiateVariableFont(font, {"wght": 700}, inplace=True)
gs, cmap = font.getGlyphSet(), font.getBestCmap()
CAP = font["OS/2"].sCapHeight

def line(text, cap_px, x0, baseline):
    k = cap_px / CAP
    pen = SVGPathPen(gs)
    x = 0
    for ch in text:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, x0 + x * k, baseline)))
        x += gs[g].width
    return pen.getCommands(), x0 + x * k

# lockup units: document 232 tall (y 12..244 in the symbol grid), proportions measured on the old app_logo
CAPH = 95
l1, _ = line("File", CAPH, 0, 0)
l2, w2 = line("Harbor", CAPH, 0, 0)
TX = 215 + 60                                  # text starts 60 after the document's right edge
LOCK_W = int(TX + w2 + 41)                     # right margin = the symbol's left margin
def lockup(color):
    return (symbol(color) +
            f'<g fill="{color}"><path transform="translate({TX} 128)" d="{l1}"/>'
            f'<path transform="translate({TX} 232)" d="{l2}"/></g>')
LVB = f"0 0 {LOCK_W} 256"

files = {
    "fileharbor-lockup.svg": svg(LVB, lockup(INK)),
    "fileharbor-lockup-black.svg": svg(LVB, lockup("#000000")),
    "fileharbor-lockup-white.svg": svg(LVB, lockup(WHITE)),
    "fileharbor-lockup-mono-c7c6f5.svg": svg(LVB, lockup(PERI)),
    "fileharbor-symbol.svg": svg("0 0 256 256", symbol(INK)),
    "fileharbor-symbol-black.svg": svg("0 0 256 256", symbol("#000000")),
    "fileharbor-symbol-white.svg": svg("0 0 256 256", symbol(WHITE)),
    "fileharbor-symbol-mono-c7c6f5.svg": svg("0 0 256 256", symbol(PERI)),
    "fileharbor-symbol-small.svg": svg("0 0 256 256", symbol(INK, True), "FileHarbor (small sizes)"),
    "fileharbor-symbol-small-white.svg": svg("0 0 256 256", symbol(WHITE, True)),
    "fileharbor-symbol-small-mono-c7c6f5.svg": svg("0 0 256 256", symbol(PERI, True)),
    "fileharbor-symbol-square.svg": svg("0 0 256 256", f'<g transform="translate(25.6 25.6) scale(0.8)">{symbol(INK)}</g>'),
    "fileharbor-symbol-app-icon.svg": svg("0 0 256 256",
        grad("g", NAVY_A, NAVY_B) + '<rect width="256" height="256" rx="57.6" fill="url(#g)"/>'
        f'<g transform="translate(38.4 38.4) scale(0.7)">{symbol(WHITE)}</g>'),
    # adapts to the tab bar: ink on light, white on dark
    "fileharbor-symbol-favicon.svg": svg("10 10 236 236",
        '<style>g{color:#111}@media (prefers-color-scheme:dark){g{color:#fff}}</style>'
        f'<g>{symbol("currentColor", True)}</g>'),
    "fileharbor-stream-deck-navy.svg": svg("0 0 288 288",
        grad("g", NAVY_A, NAVY_B) + '<rect width="288" height="288" fill="url(#g)"/>'
        f'<g transform="translate(57.6 57.6) scale(0.675)">{symbol(WHITE)}</g>'),
    "fileharbor-stream-deck-dark.svg": svg("0 0 288 288",
        '<rect width="288" height="288" fill="#0d1117"/>'
        f'<g transform="translate(57.6 57.6) scale(0.675)">{symbol(PERI)}</g>'),
}
for name, content in files.items():
    open(os.path.join(OUT, name), "w").write(content)

def png(src_svg, dst, width):
    data = resvg_py.svg_to_bytes(svg_string=src_svg, width=width)
    open(os.path.join(OUT, dst), "wb").write(bytes(data))

png(files["fileharbor-lockup-black.svg"], "png/fileharbor-lockup-black.png", 1000)
png(files["fileharbor-lockup-mono-c7c6f5.svg"], "png/fileharbor-lockup-periwinkle.png", 1000)
png(files["fileharbor-lockup-white.svg"], "../../app_logo.png", 1035)
for v in ("black", "white", "mono-c7c6f5"):
    png(files[f"fileharbor-symbol-{v}.svg"], f"png/fileharbor-symbol-{v}.png", 512)
icon = files["fileharbor-symbol-app-icon.svg"]
for n in (16, 32, 48):
    # small cut, larger in the tile: at 16 px every pixel of margin is lost legibility
    small_tile = icon.replace(f'<g transform="translate(38.4 38.4) scale(0.7)">{symbol(WHITE)}', f'<g transform="translate(18 18) scale(0.86)">{symbol(WHITE, True)}')
    png(small_tile, f"web/favicon-{n}.png", n)
for n in (192, 512):
    png(icon, f"web/icon-{n}.png", n)
# Apple masks the corners itself: full-bleed square
png(icon.replace('rx="57.6" ', ""), "web/apple-touch-icon.png", 180)
for v in ("navy", "dark"):
    for n in (288, 144):
        png(files[f"fileharbor-stream-deck-{v}.svg"], f"stream-deck/fileharbor-{v}-{n}.png", n)
w = os.path.join(OUT, "web")
subprocess.run(["magick", f"{w}/favicon-16.png", f"{w}/favicon-32.png", f"{w}/favicon-48.png", f"{w}/favicon.ico"], check=True)
print("lockup width", LOCK_W)
