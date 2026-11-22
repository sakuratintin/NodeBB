import base64, io, os
from PIL import Image

src = Image.open(r"D:\nodebb\icons\chibi-render.png").convert("RGBA")
OUT = r"D:\nodebb\icons"

def b64(img, colors=128):
    q = img.convert("RGB").quantize(colors=colors, method=Image.MEDIANCUT)
    buf = io.BytesIO()
    q.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

# 多尺寸导出
for s in (512, 256, 192, 180, 64, 48, 32):
    src.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f"forum-icon-{s}.png"))

src.save(os.path.join(OUT, "forum-icon.ico"), format="ICO",
         sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])

fav64 = b64(src.resize((64, 64), Image.LANCZOS))
apple180 = b64(src.resize((180, 180), Image.LANCZOS))

js = """/*
 * 论坛图标（favicon / 手机主屏图标）
 * 直接内嵌 base64，不依赖服务器文件
 */
(function () {
	'use strict';

	var FAVICON = 'data:image/png;base64,%s';
	var APPLE = 'data:image/png;base64,%s';

	function addLink(rel, href, sizes, type) {
		var sel = 'link[rel="' + rel + '"]';
		var el = document.querySelector(sel);
		if (!el) {
			el = document.createElement('link');
			el.rel = rel;
			document.head.appendChild(el);
		}
		if (sizes) el.setAttribute('sizes', sizes);
		el.type = type || 'image/png';
		el.href = href;
	}

	function apply() {
		addLink('icon', FAVICON, '64x64', 'image/png');
		addLink('shortcut icon', FAVICON, '64x64', 'image/png');
		addLink('apple-touch-icon', APPLE, '180x180', 'image/png');
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', apply);
	} else {
		apply();
	}
})();
""" % (fav64, apple180)

with open(r"D:\nodebb\custom-ui\favicon.js", "w", encoding="utf-8") as f:
    f.write(js)

print("favicon bytes:", len(fav64), "apple bytes:", len(apple180))
print("js size:", os.path.getsize(r"D:\nodebb\custom-ui\favicon.js"))
