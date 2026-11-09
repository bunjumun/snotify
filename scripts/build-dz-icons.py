#!/usr/bin/env python3
"""Build fonts/dz-icons.woff2, the Lakehorse theme's icon set (CR-181).

Why this is a font and not a pile of SVGs. The site is dressed with colour
emoji (a music note, a palette, a rocket, a wastebasket...) in about three
hundred places, and a fair share of them are written by JavaScript into
buttons and rows. Swapping each for an <svg> means editing every template and
trusting that nothing reads the text back. A font avoids all of that: the
emoji stay in the markup, and the theme puts this font first in the stack with
a unicode-range that names exactly those code points, so the browser draws our
glyph where it would have fetched a colour emoji. Other bands never name the
font, so they keep their emoji. Colour comes from `currentColor`, which is the
whole point: the chrome is black, grey and white and an icon should be too.

The look. Hull plate pictograms: solid, chamfered, straight-edged, with the
detail cut OUT of the shape rather than drawn on it, so they survive at 14px.
Nothing is round, because nothing on a painted hull is. Where a thing is
usually round (a disc, a globe, a target) it is an octagon or a twelve-gon.

Authoring. Each icon is a list of polygons on a 100 x 100 grid, y pointing
down like SVG. ('o', pts) adds ink, ('h', pts) cuts a hole. Orientation is
fixed here, not by hand: outer contours clockwise, holes anticlockwise, which
is what makes TrueType's non-zero winding treat the second kind as a hole.
One rule to remember when drawing: do not put a hole where two outer shapes
overlap, because the winding there is 2 and the hole only takes it back to 1.

Run (needs fontTools and brotli, which are build tools, not site dependencies,
so keep them in a throwaway venv):
    python3 -m venv /tmp/dzv && /tmp/dzv/bin/pip install fonttools brotli
    /tmp/dzv/bin/python scripts/build-dz-icons.py
Add --preview to also write fonts/dz-icons-preview.html.
"""
import math, pathlib, sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = pathlib.Path(__file__).resolve().parent.parent
UPM, ASC, DESC = 1000, 880, -120

# 100-unit grid -> font units. Ink spans x 50..950 and y 800..-100, which sits
# an emoji-sized box on the baseline with a little below it, where emoji sit.
X = lambda x: 50 + x * 9
Y = lambda y: 800 - y * 9

def rect(x, y, w, h): return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
def ngon(cx, cy, r, n=8, rot=22.5):
    return [(cx + r * math.cos(math.radians(rot + 360 * i / n)),
             cy + r * math.sin(math.radians(rot + 360 * i / n))) for i in range(n)]
def bar(x1, y1, x2, y2, t):
    """A straight bar of thickness t between two points."""
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy) or 1
    px, py = -dy / n * t / 2, dx / n * t / 2
    return [(x1 + px, y1 + py), (x2 + px, y2 + py), (x2 - px, y2 - py), (x1 - px, y1 - py)]
def orect(cx, cy, l, w, ang):
    """A rectangle l long and w wide, centred on (cx, cy), turned by ang degrees."""
    c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    return [(cx + dx * c - dy * s, cy + dx * s + dy * c)
            for dx, dy in ((-l / 2, -w / 2), (l / 2, -w / 2), (l / 2, w / 2), (-l / 2, w / 2))]
def gear(cx, cy, ro, ri, teeth=8):
    pts = []
    for k in range(teeth):
        a = 360 * k / teeth
        for da, r in ((-14, ri), (-8, ro), (8, ro), (14, ri)):
            pts.append((cx + r * math.cos(math.radians(a + da)), cy + r * math.sin(math.radians(a + da))))
    return pts
O = lambda p: ('o', p)
H = lambda p: ('h', p)

ICONS = {
 # name: (code points, shapes)
 'music':  ([0x1F3B5], [O(rect(57, 12, 10, 58)), O(ngon(45, 72, 17, 8)),
                        O([(67, 12), (90, 26), (90, 44), (67, 30)])]),
 # the art easel and palette become a framed picture: a gallery plate
 'art':    ([0x1F3A8], [O([(10, 16), (90, 16), (90, 84), (10, 84)]), H(rect(22, 28, 56, 44)),
                        O([(26, 68), (44, 42), (56, 58), (64, 48), (76, 68)]), O(rect(62, 31, 10, 10))]),
 'game':   ([0x1F3AE], [O([(8, 40), (20, 28), (80, 28), (92, 40), (92, 66), (80, 76), (66, 76), (58, 64),
                           (42, 64), (34, 76), (20, 76), (8, 66)]),
                        H([(30, 34), (36, 34), (36, 40), (42, 40), (42, 46), (36, 46), (36, 52), (30, 52),
                           (30, 46), (24, 46), (24, 40), (30, 40)]),
                        H(rect(64, 40, 8, 8)), H(rect(76, 50, 8, 8))]),
 'book':   ([0x1F4D6], [O([(8, 22), (46, 28), (46, 82), (8, 76)]), O([(54, 28), (92, 22), (92, 76), (54, 82)]),
                        H([(14, 38), (40, 42), (40, 47), (14, 43)]), H([(14, 52), (40, 56), (40, 61), (14, 57)]),
                        H([(60, 42), (86, 38), (86, 43), (60, 47)]), H([(60, 56), (86, 52), (86, 57), (60, 61)])]),
 # a delta-wing craft pointing up: the same ship as the one on the waveform
 'rocket': ([0x1F680], [O([(50, 6), (66, 30), (66, 62), (82, 86), (60, 78), (50, 94), (40, 78), (18, 86),
                           (34, 62), (34, 30)]), H(ngon(50, 38, 8, 8))]),
 'disc':   ([0x1F4BF], [O(ngon(50, 50, 44, 12, 15)), H(ngon(50, 50, 34, 12, 15)), O(ngon(50, 50, 27, 12, 15)),
                        H(ngon(50, 50, 9, 8))]),
 'trash':  ([0x1F5D1], [O(rect(12, 20, 76, 10)), O(rect(38, 9, 24, 11)),
                        O([(22, 34), (78, 34), (72, 91), (28, 91)]),
                        H([(37, 44), (44, 44), (45, 82), (38, 82)]), H([(56, 44), (63, 44), (62, 82), (55, 82)])]),
 'link':   ([0x1F517], [O(orect(35, 65, 46, 24, -45)), H(orect(35, 65, 28, 8, -45)),
                        O(orect(65, 35, 46, 24, -45)), H(orect(65, 35, 28, 8, -45))]),
 'chat':   ([0x1F4AC], [O([(8, 14), (92, 14), (92, 66), (60, 66), (40, 90), (40, 66), (8, 66)]),
                        H(rect(22, 28, 56, 6)), H(rect(22, 42, 34, 6))]),
 'folder': ([0x1F4C1], [O([(8, 22), (38, 22), (46, 32), (92, 32), (92, 84), (8, 84)]), H(rect(18, 50, 64, 6))]),
 'phones': ([0x1F3A7], [O([(14, 62), (14, 40), (30, 14), (70, 14), (86, 40), (86, 62), (74, 62), (74, 44),
                           (64, 26), (36, 26), (26, 44), (26, 62)]),
                        O(rect(9, 54, 24, 34)), O(rect(67, 54, 24, 34))]),
 'bulb':   ([0x1F4A1], [O(ngon(50, 38, 29, 8)), O([(37, 60), (63, 60), (61, 74), (39, 74)]),
                        O(rect(39, 78, 22, 6)), O(rect(42, 87, 16, 5))]),
 'pencil': ([0x270F],  [O([(18, 70), (62, 26), (74, 38), (30, 82)]), O([(18, 70), (30, 82), (8, 92)]),
                        O([(66, 22), (76, 12), (88, 24), (78, 34)])]),
 'plus':   ([0x2795],  [O([(38, 14), (62, 14), (62, 38), (86, 38), (86, 62), (62, 62), (62, 86), (38, 86),
                           (38, 62), (14, 62), (14, 38), (38, 38)])]),
 'globe':  ([0x1F310], [O(ngon(50, 50, 43, 12, 15)), H(ngon(50, 50, 35, 12, 15)),
                        O(rect(10, 46, 80, 8)), O(rect(46, 10, 8, 80)),
                        O(bar(27, 22, 27, 78, 6)), O(bar(73, 22, 73, 78, 6))]),
 'lock':   ([0x1F512], [O([(26, 48), (26, 28), (38, 12), (62, 12), (74, 28), (74, 48), (64, 48), (64, 32),
                           (58, 22), (42, 22), (36, 32), (36, 48)]),
                        O(rect(16, 44, 68, 46)), H(rect(46, 56, 8, 10)), H(rect(48, 66, 4, 12))]),
 'memo':   ([0x1F4DD], [O([(16, 8), (64, 8), (84, 28), (84, 92), (16, 92)]),
                        H(rect(28, 40, 44, 6)), H(rect(28, 54, 44, 6)), H(rect(28, 68, 28, 6))]),
 'radio':  ([0x1F4FB], [O(rect(8, 34, 84, 54)), O(bar(26, 34, 62, 10, 6)),
                        H(rect(16, 46, 30, 5)), H(rect(16, 56, 30, 5)), H(rect(16, 66, 30, 5)),
                        H(ngon(70, 62, 13, 8))]),
 'ship':   ([0x1F6A2], [O([(6, 62), (94, 62), (80, 88), (20, 88)]), O(rect(28, 38, 44, 24)),
                        O(rect(44, 20, 12, 18)), H(rect(34, 46, 8, 7)), H(rect(46, 46, 8, 7)), H(rect(58, 46, 8, 7))]),
 'target': ([0x1F3AF], [O(ngon(50, 50, 44, 12, 15)), H(ngon(50, 50, 36, 12, 15)), O(ngon(50, 50, 28, 12, 15)),
                        H(ngon(50, 50, 20, 12, 15)), O(ngon(50, 50, 10, 8))]),
 'cal':    ([0x1F4C5], [O(rect(10, 18, 80, 72)), O(rect(26, 8, 8, 16)), O(rect(66, 8, 8, 16)),
                        H(rect(20, 44, 14, 12)), H(rect(43, 44, 14, 12)), H(rect(66, 44, 14, 12)),
                        H(rect(20, 64, 14, 12)), H(rect(43, 64, 14, 12))]),
 'film':   ([0x1F39E], [O(rect(10, 18, 80, 64)), H(rect(18, 40, 64, 20)),
                        H(rect(16, 24, 8, 8)), H(rect(30, 24, 8, 8)), H(rect(44, 24, 8, 8)), H(rect(58, 24, 8, 8)), H(rect(72, 24, 8, 8)),
                        H(rect(16, 68, 8, 8)), H(rect(30, 68, 8, 8)), H(rect(44, 68, 8, 8)), H(rect(58, 68, 8, 8)), H(rect(72, 68, 8, 8))]),
 'wrench': ([0x1F527], [O([(14, 14), (30, 8), (44, 22), (36, 30), (26, 20), (20, 26), (30, 36), (24, 46),
                           (8, 36)]), O(bar(30, 30, 84, 84, 15))]),
 'fire':   ([0x1F525], [O([(50, 6), (66, 30), (78, 48), (82, 64), (74, 82), (58, 93), (42, 93), (26, 82),
                           (18, 64), (26, 44), (36, 54), (40, 30)]),
                        H([(50, 52), (60, 68), (58, 82), (42, 82), (40, 68)])]),
 'thought': ([0x1F4AD], [O([(10, 14), (90, 14), (90, 58), (10, 58)]),
                         H(rect(22, 30, 10, 10)), H(rect(45, 30, 10, 10)), H(rect(68, 30, 10, 10)),
                         O(rect(22, 66, 14, 14)), O(rect(12, 86, 8, 8))]),
 'mixer':  ([0x1F39A], [O(rect(18, 10, 8, 80)), O(rect(46, 10, 8, 80)), O(rect(74, 10, 8, 80)),
                        O(rect(8, 56, 28, 14)), O(rect(36, 24, 28, 14)), O(rect(64, 44, 28, 14))]),
 'tick':   ([0x2705],  [O(rect(10, 10, 80, 80)),
                        H([(24, 50), (34, 40), (44, 50), (66, 28), (76, 38), (44, 70)])]),
 'scroll': ([0x1F4DC], [O([(18, 12), (82, 12), (82, 70), (64, 70), (64, 88), (18, 88)]),
                        H(rect(28, 26, 44, 6)), H(rect(28, 40, 44, 6)), H(rect(28, 54, 26, 6))]),
 'up':     ([0x2B06],  [O([(50, 8), (84, 46), (62, 46), (62, 92), (38, 92), (38, 46), (16, 46)])]),
 'down':   ([0x2B07],  [O([(50, 92), (84, 54), (62, 54), (62, 8), (38, 8), (38, 54), (16, 54)])]),
 'gear':   ([0x2699],  [O(gear(50, 50, 44, 34)), H(ngon(50, 50, 14, 8))]),
}

def area(pts):  # shoelace; positive = anticlockwise in a y-up system
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                     for i in range(len(pts)))

def glyph_of(shapes):
    pen = TTGlyphPen(None)
    xs = []
    for kind, pts in shapes:
        fp = [(round(X(x)), round(Y(y))) for x, y in pts]
        a = area(fp)
        if (kind == 'o' and a > 0) or (kind == 'h' and a < 0):
            fp.reverse()
        pen.moveTo(fp[0])
        for p in fp[1:]: pen.lineTo(p)
        pen.closePath()
        xs += [p[0] for p in fp]
    return pen.glyph(), (min(xs) if xs else 0)

def main():
    order, glyphs, metrics, cmap = ['.notdef'], {'.notdef': TTGlyphPen(None).glyph()}, {'.notdef': (UPM // 2, 0)}, {}
    for name, (cps, shapes) in ICONS.items():
        g, lsb = glyph_of(shapes)
        gname = 'dz_' + name
        order.append(gname); glyphs[gname] = g; metrics[gname] = (UPM, lsb)
        for cp in cps: cmap[cp] = gname
    # The emoji variation selector rides behind a base character (a pencil is
    # written U+270F U+FE0F). Giving it an empty zero-width glyph here means the
    # whole cluster is covered by this font, and the browser has no reason to
    # reach for a colour emoji font for it.
    order.append('vs16'); glyphs['vs16'] = TTGlyphPen(None).glyph(); metrics['vs16'] = (0, 0); cmap[0xFE0F] = 'vs16'

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASC, descent=DESC)
    fb.setupNameTable({'familyName': 'Lakehorse Icons', 'styleName': 'Regular'})
    fb.setupOS2(sTypoAscender=ASC, sTypoDescender=DESC, sTypoLineGap=0, usWinAscent=ASC, usWinDescent=-DESC,
                sxHeight=500, sCapHeight=700)
    fb.setupPost()
    fb.font.flavor = 'woff2'
    out = ROOT / 'fonts' / 'dz-icons.woff2'
    fb.save(str(out))
    ranges = ', '.join('U+%X' % cp for cp in sorted(cmap))
    print('wrote', out, out.stat().st_size, 'bytes,', len(ICONS), 'icons')
    print('unicode-range:', ranges)
    if '--preview' in sys.argv:
        cells = ''.join('<div><span>%s</span><small>%s</small></div>' % (''.join(chr(c) for c in cps), n)
                        for n, (cps, _) in ICONS.items())
        (ROOT / 'fonts' / 'dz-icons-preview.html').write_text(
            '<!doctype html><meta charset=utf-8><style>@font-face{font-family:DZ;src:url(dz-icons.woff2)}'
            'body{background:#08080a;color:#fff;font:12px system-ui;margin:16px}'
            'div{display:inline-block;width:150px;margin:6px;text-align:center}'
            'span{font-family:DZ;font-size:64px;display:block;line-height:1.1}'
            'div:nth-child(n) span::after{content:""}'
            '.s span{font-size:14px;display:inline}.m span{font-size:30px;display:inline}</style>'
            + cells + '<hr><p style="font-family:DZ;font-size:14px">' + ' '.join(
                ''.join(chr(c) for c in cps) for cps, _ in ICONS.values()) + '</p>'
            '<p style="font-family:DZ;font-size:30px">' + ' '.join(
                ''.join(chr(c) for c in cps) for cps, _ in ICONS.values()) + '</p>')

main()
