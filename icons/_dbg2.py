from PIL import Image
from collections import Counter
src = Image.open(r"D:\nodebb\icons\ref-source.png").convert("RGB")
w, h = src.size
px = src.load()
print("corners:", px[0,0], px[w-1,0], px[0,h-1], px[w-1,h-1], "2,2:", px[2,2])
c = Counter(src.getdata())
print("top colors:", c.most_common(3))
