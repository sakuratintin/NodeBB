import base64, io, os
from PIL import Image

src = Image.open(r"D:\nodebb\icons\chibi-render.png").convert("RGB")
OUT = r"D:\nodebb\icons"

def b64(img, colors=160):
    q = img.quantize(colors=colors, method=Image.MEDIANCUT)
    buf = io.BytesIO()
    q.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

for s in (512, 256, 192, 180, 64, 48, 32):
    src.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f"forum-icon-{s}.png"))

src.convert("RGBA").save(os.path.join(OUT, "forum-icon.ico"), format="ICO",
                         sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])

fav64 = b64(src.resize((64, 64), Image.LANCZOS))
apple180 = b64(src.resize((180, 180), Image.LANCZOS))
icon192 = b64(src.resize((192, 192), Image.LANCZOS))

js = """/*
 * 论坛图标（浏览器标签 / 手机主屏 / 苹果主屏）
 * 内嵌 base64，不依赖服务器文件
 */
(function () {
	'use strict';

	var FAV = 'data:image/png;base64,%s';
	var APPLE = 'data:image/png;base64,%s';
	var ANDROID = 'data:image/png;base64,%s';

	function setLink(rel, href, sizes, type) {
		var el = document.querySelector('link[rel="' + rel + '"]');
		if (!el) {
			el = document.createElement('link');
			el.rel = rel;
			document.head.appendChild(el);
		}
		el.type = type || 'image/png';
		el.href = href;
		if (sizes) el.setAttribute('sizes', sizes);
	}

	function apply() {
		setLink('icon', FAV, '64x64');
		setLink('shortcut icon', FAV, '64x64');
		setLink('apple-touch-icon', APPLE, '180x180');
		setLink('apple-touch-icon-precomposed', APPLE, '180x180');
		// 安卓「添加到主屏幕」会优先用这两个尺寸
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

print("sizes b64:", len(fav64), len(apple180), len(icon192))
print("js bytes:", os.path.getsize(r"D:\nodebb\custom-ui\favicon.js"))
