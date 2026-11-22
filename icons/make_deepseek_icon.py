# -*- coding: utf-8 -*-
"""
生成桌面图标：DeepSeek 鲸鱼娘 + 小鸡头套（第二版排版）
输出：PNG（多尺寸预览）与 ICO（Windows 图标）
"""
import os
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = r"D:\nodebb\icons"


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def gradient_bg(size, top="#9ec8ff", bottom="#3f66ff"):
    top_rgb = tuple(int(top[i:i + 2], 16) for i in (1, 3, 5))
    bot_rgb = tuple(int(bottom[i:i + 2], 16) for i in (1, 3, 5))
    img = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        img.putpixel((0, y), lerp(top_rgb, bot_rgb, t))
    return img.resize((size, size))


def whale_fluke(size=520, color=(58, 92, 250, 255), light=None):
    """画一个鲸鱼尾鳍（两瓣 + 缺口 + 尾柄），尺寸自适应"""
    size = int(size)
    if size < 32:
        size = 32
    m = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(m)

    def E(x0, y0, x1, y1):
        md.ellipse([x0 * size, y0 * size, x1 * size, y1 * size], fill=255)

    # 左右两瓣
    E(0.06, 0.16, 0.50, 0.62)
    E(0.50, 0.16, 0.94, 0.62)
    # 中间缺口
    md.polygon(
        [(0.40 * size, 0.58 * size), (0.60 * size, 0.58 * size), (0.50 * size, 0.93 * size)],
        fill=0,
    )
    # 尾柄
    E(0.41, 0.52, 0.59, 0.99)

    solid = Image.new("RGBA", (size, size), color)
    solid.putalpha(m)
    return solid

def draw_icon(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = size / 1024.0

    Z = 1.14  # 整体放大一点，小尺寸下更清楚

    def P(x, y):
        return (((x - 512) * Z + 512) * s, ((y - 512) * Z + 512) * s)

    def box(x0, y0, x1, y1):
        return [
            ((x0 - 512) * Z + 512) * s,
            ((y0 - 512) * Z + 512) * s,
            ((x1 - 512) * Z + 512) * s,
            ((y1 - 512) * Z + 512) * s,
        ]

    def R(v):
        return v * Z * s

    # ---------- 背景 ----------
    bg = gradient_bg(size).convert("RGBA")
    bg.putalpha(rounded_mask(size, int(R(210))))
    img.alpha_composite(bg)

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    gd.ellipse(box(150, 90, 880, 760), fill=(255, 255, 255, 60))
    glow = glow.filter(ImageFilter.GaussianBlur(R(100)))
    img.alpha_composite(glow)

    d = ImageDraw.Draw(img, "RGBA")

    # ---------- 鲸鱼尾鳍发夹（小一点，别抢戏） ----------
    # ---------- 身体 / 肩膀 ----------
    body = (198, 231, 255, 255)
    d.ellipse(box(250, 690, 774, 1060), fill=body)
    # 白肚皮
    d.ellipse(box(392, 760, 632, 1030), fill=(255, 255, 255, 235))

    # ---------- 头发（浅蓝，脸后侧） ----------
    hair = (146, 208, 255, 255)
    hair_dark = (104, 176, 240, 255)
    d.ellipse(box(296, 430, 728, 900), fill=hair)
    # 两侧长发
    d.polygon([P(300, 640), P(238, 940), P(392, 850)], fill=hair)
    d.polygon([P(724, 640), P(786, 940), P(632, 850)], fill=hair)
    d.polygon([P(300, 660), P(268, 880), P(360, 820)], fill=hair_dark)

    # ---------- 脸 ----------
    skin = (255, 227, 208, 255)
    d.ellipse(box(316, 520, 708, 880), fill=skin)
    # 脸部阴影
    d.ellipse(box(360, 780, 664, 900), fill=(246, 205, 185, 70))

    # ---------- 刘海（压在脸上方，制造「头套下有头发」） ----------
    d.ellipse(box(330, 470, 700, 620), fill=hair)
    d.polygon([P(352, 560), P(330, 640), P(404, 596)], fill=hair)
    d.polygon([P(672, 560), P(694, 640), P(620, 596)], fill=hair)

    # ---------- 小鸡头套 ----------
    hood = (255, 214, 92, 255)
    hood_dark = (238, 182, 54, 255)
    hood_light = (255, 232, 150, 255)

    # 头套主体（比脸大一圈，罩住头顶）
    d.ellipse(box(286, 196, 738, 636), fill=hood)
    # 高光
    d.ellipse(box(352, 236, 520, 342), fill=hood_light)
    # 呆毛
    d.polygon([P(478, 224), P(506, 132), P(530, 226)], fill=hood)
    d.polygon([P(530, 228), P(566, 156), P(574, 232)], fill=hood)
    d.polygon([P(434, 234), P(452, 168), P(484, 234)], fill=hood)

    # 鸡嘴
    d.polygon([P(474, 336), P(550, 336), P(512, 402)], fill=(255, 160, 30, 255))
    d.line([P(474, 336), P(550, 336)], fill=(233, 134, 14, 255), width=int(R(7)))

    # 头套眼睛
    for ex in (416, 608):
        d.ellipse(box(ex - 31, 252, ex + 31, 328), fill=(40, 40, 52, 255))
        d.ellipse(box(ex - 12, 264, ex + 8, 290), fill=(255, 255, 255, 240))
        d.ellipse(box(ex + 10, 298, ex + 24, 314), fill=(255, 255, 255, 140))

    # 头套腮红
    d.ellipse(box(330, 338, 404, 384), fill=(255, 140, 160, 95))
    d.ellipse(box(620, 338, 694, 384), fill=(255, 140, 160, 95))

    # 头套下沿描边
    d.arc(box(286, 196, 738, 636), start=40, end=140, fill=hood_dark, width=int(R(9)))

    # ---------- 鲸鱼尾鳍发夹（别在头套左侧） ----------
    clip = whale_fluke(int(R(230)), color=(58, 92, 250, 255), light=(126, 160, 255, 255))
    clip = clip.rotate(-28, resample=Image.BICUBIC, expand=False)
    img.alpha_composite(clip, (int(R(214)), int(R(392))))
    d = ImageDraw.Draw(img, "RGBA")

    # ---------- 五官 ----------
    for ex in (430, 594):
        # 眼白
        d.ellipse(box(ex - 40, 628, ex + 40, 736), fill=(255, 255, 255, 255))
        # 瞳
        d.ellipse(box(ex - 30, 640, ex + 30, 730), fill=(46, 66, 132, 255))
        d.ellipse(box(ex - 22, 652, ex + 8, 700), fill=(255, 255, 255, 245))
        d.ellipse(box(ex + 12, 704, ex + 28, 722), fill=(255, 255, 255, 165))
        # 上睫毛
        d.line([P(ex - 42, 632), P(ex - 54, 610)], fill=(46, 66, 132, 255), width=int(R(8)))

    # 腮红
    d.ellipse(box(340, 726, 416, 768), fill=(255, 150, 170, 115))
    d.ellipse(box(608, 726, 684, 768), fill=(255, 150, 170, 115))

    # 嘴（小微笑）
    d.arc(box(482, 730, 542, 784), start=20, end=160, fill=(198, 106, 120, 255), width=int(R(9)))

    # ---------- 喷水 ----------
    for cx, cy, r in [(792, 300, 15), (830, 258, 10), (856, 224, 6)]:
        d.ellipse(box(cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 200))

    # ---------- 内描边 ----------
    d.rounded_rectangle(
        [int(R(6)), int(R(6)), size - int(R(6)), size - int(R(6))],
        radius=int(R(204)),
        outline=(255, 255, 255, 70),
        width=int(R(8)),
    )

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    big = draw_icon(1024)

    big.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT_DIR, "deepseek-chick-512.png"))
    big.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT_DIR, "deepseek-chick-256.png"))
    big.save(
        os.path.join(OUT_DIR, "deepseek-chick.ico"),
        format="ICO",
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
    )
    print("done")


if __name__ == "__main__":
    main()
