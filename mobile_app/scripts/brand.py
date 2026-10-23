"""Generate native brand assets from the repository's canonical Manul artwork.

Run from anywhere: python3 mobile_app/scripts/brand.py
Requires Pillow; fontTools + brotli are needed only to regenerate bundled fonts.
"""
from pathlib import Path
import json
from PIL import Image

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parent
RES = APP / 'android/app/src/main/res'
IOS = APP / 'ios/Runner/Assets.xcassets'
cat = Image.open(ROOT / 'src/renderer/public/manul.png').convert('RGBA')
canonical = Image.open(ROOT / 'build/icons/1024x1024.png').convert('RGBA')

def save(image, path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size, size), Image.Resampling.LANCZOS).save(path)

# iOS masks square artwork itself. Flatten transparent edges onto brand fur,
# rather than shipping alpha (which App Store validation rejects).
store = Image.new('RGB', canonical.size, '#161412')
store.paste(canonical, mask=canonical.getchannel('A'))
manifest = json.loads((IOS / 'AppIcon.appiconset/Contents.json').read_text())
for item in manifest['images']:
    size = round(float(item['size'].split('x')[0]) * float(item['scale'][:-1]))
    save(store, IOS / 'AppIcon.appiconset' / item['filename'], size)
save(store, APP / 'assets/brand/app-store-1024.png', 1024)
save(store, APP / 'assets/brand/play-store-512.png', 512)

# Adaptive foreground keeps the actual cat inside Android's 66/108 safe zone.
foreground = Image.new('RGBA', (1080, 1080))
safe_cat = cat.resize((640, 640), Image.Resampling.LANCZOS)
foreground.alpha_composite(safe_cat, (220, 220))
monochrome = Image.new('RGBA', foreground.size, 'white')
monochrome.putalpha(foreground.getchannel('A'))
for density, scale in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]:
    save(store, RES / f'mipmap-{density}/ic_launcher.png', round(48 * scale))
    save(foreground, RES / f'drawable-{density}/ic_launcher_foreground.png', round(108 * scale))
    save(monochrome, RES / f'drawable-{density}/ic_launcher_monochrome.png', round(108 * scale))
    save(cat, RES / f'drawable-{density}/launch_logo.png', round(120 * scale))
for scale, suffix in [(1, ''), (2, '@2x'), (3, '@3x')]:
    save(cat, IOS / f'LaunchImage.imageset/LaunchImage{suffix}.png', 120 * scale)
save(cat, APP / 'assets/manul.png', 1024)

# Reuse the same OFL fonts as desktop, packaged locally (no runtime font requests).
try:
    from fontTools.ttLib import TTFont
    for package, name in [('inter', 'Inter'), ('source-serif-4', 'SourceSerif4')]:
        source = ROOT / f'node_modules/@fontsource-variable/{package}/files/{package}-latin-wght-normal.woff2'
        font = TTFont(source)
        font.flavor = None
        target = APP / f'assets/fonts/{name}.ttf'
        target.parent.mkdir(parents=True, exist_ok=True)
        font.save(target)
        (target.parent / f'{name}-OFL.txt').write_text((ROOT / f'node_modules/@fontsource-variable/{package}/LICENSE').read_text())
except ImportError:
    print('Fonts skipped; install fontTools and brotli to regenerate them.')
print('Generated Manul launcher, splash, store and in-app assets.')
