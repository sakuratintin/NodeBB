from PIL import Image
src = Image.open(r"D:\nodebb\icons\ref-source.png").convert("RGB")
w, h = src.size
px = src.load()
for x in range(w-1, w-16, -1):
    col = [px[x, y] for y in range(h)]
    avg = tuple(sum(c[i] for c in col)//h for i in range(3))
    print(x, avg)
