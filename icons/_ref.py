import base64, io, os
from PIL import Image, ImageFilter

SRC = r"D:\nodebb\icons\ref-source.png"
OUT = r"D:\nodebb\icons"
src = Image.open(SRC).convert("RGB")
w, h = src.size

px = src.load()

def is_white(p):
    return p[0] > 235 and p[1] > 235 and p[2] > 235

# 从右往左裁掉白边
right = w
while right > 10:
    col = [px[x, y] for x in range(right - 1, max(0, right - 3), -1) for y in range(0, h, 3)]
    whites = sum(1 for p in col if is_white(p))
    if whites / max(1, len(col)) > 0.7:
        right -= 1
    else:
        break

# 从上/下也检查一下
top, bottom = 0, h
while top < h - 10:
    row = [px[x, top] for x in range(0, right, 3)]
    if sum(1 for p in row if is_white(p)) / max(1, len(row)) > 0.7:
        top += 1
    else:
        break
while bottom > 10:
    row = [px[x, bottom - 1] for x in range(0, right, 3)]
    if sum(1 for p in row if is_white(p)) / max(1, len(row)) > 0.7:
        bottom -= 1
    else:
        break

print("crop:", (0, top, right, bottom))
crop = src.crop((0, top, right, bottom))

cw, ch = crop.size
side = max(cw, ch)
bg = crop.getpixel((2, 2))
canvas = Image.new("RGB", (side, side), bg)
canvas.paste(crop, ((side - cw) // 2, (side - ch) // 2))

big = canvas.resize((1024, 1024), Image.LANCZOS)
big = big.filter(ImageFilter.UnsharpMask(radius=2.0, percent=105, threshold=2))

def b64(img, colors=256):
    q = img.quantize(colors=colors, method=Image.MEDIANCUT)
    buf = io.BytesIO()
    q.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

for s in (512, 256, 192, 180, 128, 64, 48, 32):
    big.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f"forum-icon-{s}.png"))

big.save(os.path.join(OUT, "forum-icon.ico"), format="ICO",
         sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])

fav64 = b64(big.resize((64, 64), Image.LANCZOS))
apple180 = b64(big.resize((180, 180), Image.LANCZOS))
icon192 = b64(big.resize((192, 192), Image.LANCZOS))

js = """/*
 * 论坛图标：蓝发困困鲸鱼娘
 * 内嵌 base64，手机主屏 / 浏览器标签都可用
 */
(function () {
	'use strict';

	var FAV = 'data:image/png;base64,%s';
	var APPLE = 'data:image/png;base64,%s';
	var ANDROID = 'data:image/png;base64,%s';

	function setLink(rel, href, sizes) {
		var el = document.querySelector('link[rel="' + rel + '"]');
		if (!el) {
			el = document.createElement('link');
			el.rel = rel;
			document.head.appendChild(el);
		}
		el.type = 'image/png';
		el.href = href;
		if (sizes) el.setAttribute('sizes', sizes);
	}

	function apply() {
		setLink('icon', FAV, '64x64');
		setLink('shortcut icon', FAV, '64x64');
		setLink('apple-touch-icon', APPLE, '180x180');
		setLink('apple-touch-icon-precomposed', APPLE, '180x180');
		setLink('icon', ANDROID, '192x192');
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', apply);
	} else {
		apply();
	}
})();
""" % (fav64, apple180, icon192)

with open(r"D:\nodebb\custom-ui\favicon.js", "w", encoding="utf-8") as f:
    f.write(js)

print("js bytes:", os.path.getsize(r"D:\nodebb\custom-ui\favicon.js"))
