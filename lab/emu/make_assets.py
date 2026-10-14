# Generates synthetic poster/backdrop JPEGs (no real artwork). Run once; output is committed.
# Size and detail are tuned so file sizes and decode cost resemble TMDB w500 posters (~40-90 KB).
import random
from PIL import Image, ImageDraw, ImageFilter
random.seed(7)
def make(w, h, path, label):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    c1 = [random.randint(0, 255) for _ in range(3)]; c2 = [random.randint(0, 255) for _ in range(3)]
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3)))
    for _ in range(60):
        x, y, r = random.randint(0, w), random.randint(0, h), random.randint(10, w // 3)
        d.ellipse([x - r, y - r, x + r, y + r], fill=tuple(random.randint(0, 255) for _ in range(3)))
    img = img.filter(ImageFilter.GaussianBlur(3))
    noise = Image.effect_noise((w, h), 40).convert("RGB")
    img = Image.blend(img, noise, 0.12)
    d = ImageDraw.Draw(img)
    d.rectangle([20, h - 110, w - 20, h - 30], fill=(0, 0, 0))
    d.text((40, h - 90), label, fill=(255, 255, 255))
    img.save(path, "JPEG", quality=80, optimize=True)
for i in range(48): make(500, 750, f"assets/posters/p{i:02d}.jpg", f"LAB POSTER {i}")
for i in range(12): make(1280, 720, f"assets/backdrops/b{i:02d}.jpg", f"LAB BACKDROP {i}")
