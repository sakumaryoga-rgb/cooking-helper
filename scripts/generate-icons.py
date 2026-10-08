"""COOKDOOR 公式画像から PWA アイコン、apple-touch-icon、favicon、OGP 画像を生成する。"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import glob, unicodedata

def font(weight, size):
    for f in glob.glob('/System/Library/Fonts/*.ttc'):
        if unicodedata.normalize('NFC', f).endswith(f'ヒラギノ角ゴシック {weight}.ttc'):
            return ImageFont.truetype(f, size)
    raise SystemExit(f'font {weight} not found')

src, pub = Path(sys.argv[1]), Path(sys.argv[2])
YELLOW = (0xFE, 0xD7, 0x12)
TEXT = (0x2B, 0x22, 0x1C)
orig = Image.open(src).convert('RGB')

def resized(size):
    return orig.resize((size, size), Image.LANCZOS)

def save(im, rel):
    p = pub / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im.save(p, optimize=True)
    print(rel, im.size)

# purpose: any(原画をそのまま縮小)
save(resized(192), 'icons/cookdoor-192.png')
save(resized(512), 'icons/cookdoor-512.png')

# purpose: maskable。中心から半径40%の安全域に冷蔵庫全体が入るよう、原画を74%に縮小し、
# 原画の背景と同じ黄色で余白を埋める(イラストと配色は変えない)
def maskable(size, scale=0.74):
    canvas = Image.new('RGB', (size, size), YELLOW)
    inner = round(size * scale)
    off = (size - inner) // 2
    canvas.paste(orig.resize((inner, inner), Image.LANCZOS), (off, off))
    return canvas
save(maskable(192), 'icons/cookdoor-maskable-192.png')
save(maskable(512), 'icons/cookdoor-maskable-512.png')

# iOS(角丸は iOS が付ける)
save(resized(180), 'apple-touch-icon.png')

# favicon
save(resized(32), 'favicon-32.png')
ico = resized(256)
ico.save(pub / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('favicon.ico')

# OGP 1200x630
W, H = 1200, 630
og = Image.new('RGB', (W, H), YELLOW)
icon = orig.resize((560, 560), Image.LANCZOS)
og.paste(icon, (60, 35))
d = ImageDraw.Draw(og)
# 右側の余白 60px に収まる最大の文字サイズにする
size = 110
while font('W8', size).getlength('COOKDOOR') > W - 650 - 60:
    size -= 2
bold = font('W8', size)
sub = font('W6', 38)
d.text((650, 215), 'COOKDOOR', font=bold, fill=TEXT)
d.text((656, 350), '冷蔵庫の食材から', font=sub, fill=TEXT)
d.text((656, 404), 'つくれる料理がわかる', font=sub, fill=TEXT)
save(og, 'og-image.png')
