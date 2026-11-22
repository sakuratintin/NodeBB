# -*- coding: utf-8 -*-
"""
论坛图标：蓝发困困鲸鱼娘（chibi 风格，原创绘制）v2
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = r"D:\nodebb\icons"


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def radial_bg(size, inner=(40, 56, 100), outer=(11, 14, 24)):
    img = Image.new("RGB", (size, size), outer)
    px = img.load()
    cx = cy = size / 2
    maxd = (size / 2) * 1.2
    for y in range(size):
        dy = y - cy
        for x in range(size):
            d = math.hypot(x - cx, dy)
            px[x, y] = lerp(inner, outer, min(1.0, d / maxd))
    return img


def draw_eye(img, cx, cy, w, h, sleep=0.40):
    """半睁的困困眼：白眼球 + 虹膜 + 厚眼睑盖住上半部分"""
    pad = 30
    W, H = int(w + pad * 2), int(h + pad * 2)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)

    # 眼白
    ld.ellipse([pad, pad, pad + w, pad + h], fill=(255, 255, 255, 255))
    # 虹膜
    iw, ih = w * 0.86, h * 0.96
    ix = pad + (w - iw) / 2
    iy = pad + h * 0.10
    ld.ellipse([ix, iy, ix + iw, iy + ih], fill=(126, 170, 222, 255))
    # 瞳孔
    pw, ph = iw * 0.62, ih * 0.72
    px = pad + (w - pw) / 2
    py = iy + (ih - ph) * 0.45
    ld.ellipse([px, py, px + pw, py + ph], fill=(34, 50, 86, 255))
    # 高光
    ld.ellipse([px + pw * 0.06, py + ph * 0.08, px + pw * 0.44, py + ph * 0.40], fill=(255, 255, 255, 245))
    ld.ellipse([px + pw * 0.56, py + ph * 0.62, px + pw * 0.86, py + ph * 0.82], fill=(255, 255, 255, 165))

    # 眼睑（盖住上半部分，制造困意）
    lid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ldd = ImageDraw.Draw(lid)
    ldd.rectangle([0, 0, W, pad + h * sleep], fill=(52, 68, 104, 255))
    # 只保留眼睛范围内的眼睑
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse([pad, pad, pad + w, pad + h], fill=255)
    lid.putalpha(Image.composite(lid.split()[3], Image.new("L", (W, H), 0), mask))
    layer.alpha_composite(lid)

    # 睫毛（眼睛外侧的短线）
    ld.line([(pad + 2, pad + h * sleep), (pad - 16, pad + h * sleep - 18)], fill=(52, 68, 104, 255), width=10)
    ld.line([(pad + w - 2, pad + h * sleep), (pad + w + 16, pad + h * sleep - 18)], fill=(52, 68, 104, 255), width=10)

    img.alpha_composite(layer, (int(cx - W / 2), int(cy - H / 2)))


def draw(size=1024):
    s = size / 1024.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    def P(x, y):
        return (x * s, y * s)

    def box(x0, y0, x1, y1):
        return [x0 * s, y0 * s, x1 * s, y1 * s]

    def R(v):
        return v * s

    # ---------- 背景 ----------
    img.alpha_composite(radial_bg(size).convert("RGBA"))
    d = ImageDraw.Draw(img, "RGBA")

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    gd.ellipse(box(230, 150, 800, 720), fill=(110, 160, 240, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(R(130)))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img, "RGBA")

    # ---------- 配色 ----------
    hair = (108, 145, 214, 255)
    hair_dark = (76, 106, 176, 255)
    hair_light = (162, 192, 240, 255)
    skin = (255, 233, 221, 255)
    skin_sh = (244, 201, 186, 255)
    navy = (44, 60, 102, 255)

    # ---------- 后发 ----------
    d.ellipse(box(196, 250, 828, 1010), fill=hair_dark)
    d.ellipse(box(168, 560, 384, 1010), fill=hair_dark)
    d.ellipse(box(640, 560, 856, 1010), fill=hair_dark)

    # ---------- 鲸鱼鳍耳 ----------
    fin = (92, 130, 202, 255)
    fin_l = (132, 168, 228, 255)
    d.polygon([P(268, 500), P(126, 600), P(258, 676)], fill=fin)
    d.polygon([P(756, 500), P(898, 600), P(766, 676)], fill=fin)
    d.polygon([P(262, 528), P(172, 594), P(256, 638)], fill=fin_l)
    d.polygon([P(762, 528), P(852, 594), P(768, 638)], fill=fin_l)

    # ---------- 脖子 / 肩 ----------
    d.ellipse(box(430, 780, 594, 900), fill=skin_sh)
    d.ellipse(box(316, 862, 708, 1120), fill=(240, 243, 250, 255))

    # ---------- 脸 ----------
    d.ellipse(box(300, 336, 724, 812), fill=skin)
    # 下巴柔和阴影
    shade = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade, "RGBA")
    sd.ellipse(box(372, 700, 652, 812), fill=(240, 196, 182, 120))
    shade = shade.filter(ImageFilter.GaussianBlur(R(28)))
    img.alpha_composite(shade)
    d = ImageDraw.Draw(img, "RGBA")

    # ---------- 头顶发 ----------
    d.ellipse(box(272, 232, 752, 620), fill=hair)
    # 发丝高光
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl, "RGBA")
    hd.ellipse(box(346, 300, 508, 372), fill=hair_light)
    hd.ellipse(box(560, 312, 690, 380), fill=hair_light)
    hd.arc(box(300, 300, 724, 700), start=200, end=340, fill=hair_light, width=int(R(9)))
    hl = hl.filter(ImageFilter.GaussianBlur(R(6)))
    img.alpha_composite(hl)
    d = ImageDraw.Draw(img, "RGBA")

    # 刘海（圆润的几缕）
    for cx, cy, rx, ry in [
        (360, 470, 78, 120),
        (470, 452, 86, 132),
        (586, 458, 82, 126),
        (690, 482, 66, 104),
    ]:
        d.ellipse(box(cx - rx, cy - ry, cx + rx, cy + ry), fill=hair)
    # 前额发际线压回脸部
    d.ellipse(box(330, 392, 694, 560), fill=skin)
    # 两侧碎发
    d.polygon([P(316, 470), P(296, 700), P(370, 620)], fill=hair)
    d.polygon([P(708, 470), P(728, 700), P(654, 620)], fill=hair)

    # ---------- 白色荷叶头饰（贴着发际） ----------
    for i in range(9):
        ang = math.radians(198 + i * 18)
        cx = 512 + math.cos(ang) * 236
        cy = 452 + math.sin(ang) * 236
        d.ellipse(box(cx - 40, cy - 34, cx + 40, cy + 34), fill=(222, 230, 246, 255))
    for i in range(9):
        ang = math.radians(198 + i * 18)
        cx = 512 + math.cos(ang) * 236
        cy = 452 + math.sin(ang) * 236
        d.ellipse(box(cx - 36, cy - 36, cx + 36, cy + 22), fill=(255, 255, 255, 255))
    # 头饰带
    d.arc(box(266, 216, 758, 700), start=200, end=340, fill=(232, 238, 250, 255), width=int(R(26)))

    # ---------- 眼睛 ----------
    draw_eye(img, 434 * s, 596 * s, 132 * s, 150 * s, sleep=0.42)
    draw_eye(img, 592 * s, 596 * s, 132 * s, 150 * s, sleep=0.42)
    d = ImageDraw.Draw(img, "RGBA")

    # ---------- 腮红 ----------
    blush = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blush, "RGBA")
    bd.ellipse(box(320, 630, 404, 686), fill=(255, 150, 168, 130))
    bd.ellipse(box(620, 630, 704, 686), fill=(255, 150, 168, 130))
    blush = blush.filter(ImageFilter.GaussianBlur(R(14)))
    img.alpha_composite(blush)
    d = ImageDraw.Draw(img, "RGBA")

    # ---------- 嘴 ----------
    d.arc(box(486, 664, 538, 706), start=18, end=162, fill=(188, 112, 122, 255), width=int(R(7)))

    # ---------- 领结 ----------
    d.polygon([P(432, 852), P(512, 886), P(432, 930)], fill=navy)
    d.polygon([P(592, 852), P(512, 886), P(592, 930)], fill=navy)
    d.ellipse(box(488, 862, 536, 910), fill=(62, 82, 132, 255))
    d.polygon([P(496, 872), P(528, 872), P(512, 900)], fill=(150, 206, 240, 255))

    # ---------- 衣服领口 ----------
    d.polygon([P(432, 900), P(512, 986), P(592, 900)], fill=(52, 68, 112, 255))

    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    big = draw(1024)
    big.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "forum-chibi-512.png"))
    big.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "forum-chibi-192.png"))
    big.resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, "forum-chibi-180.png"))
    big.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, "forum-chibi-64.png"))
    big.save(
        os.path.join(OUT, "forum-chibi.ico"),
        format="ICO",
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
    )
    print("done")


if __name__ == "__main__":
    main()
