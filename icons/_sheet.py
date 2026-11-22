from PIL import Image
src = Image.open(r"D:\nodebb\icons\deepseek-chick-512.png").convert("RGBA")
sizes = [128, 64, 48, 32, 24, 16]
pad = 16
w = sum(s + pad for s in sizes) + pad
h = 128 + pad * 2
out = Image.new("RGBA", (w, h), (245, 246, 250, 255))
x = pad
for s in sizes:
    im = src.resize((s, s), Image.LANCZOS)
    out.alpha_composite(im, (x, pad + (128 - s) // 2))
    x += s + pad
out.convert("RGB").save(r"D:\nodebb\icons\preview-sizes.png")
print("ok")
