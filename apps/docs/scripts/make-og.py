#!/usr/bin/env python3
"""Compose apps/docs/assets/og.png (1200x630) for social link previews."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SHOT = ROOT / "screenshots" / "replay-analysis-modal.png"
OUT = ASSETS / "og.png"

W, H = 1200, 630


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/outfit/Outfit-Bold.ttf" if bold else "/usr/share/fonts/truetype/outfit/Outfit-SemiBold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def main() -> None:
    canvas = Image.new("RGB", (W, H), "#0c0c0c")
    draw = ImageDraw.Draw(canvas, "RGBA")

    # Accent glows
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse((-120, -220, 520, 280), fill=(124, 143, 224, 55))
    gdraw.ellipse((780, 280, 1380, 780), fill=(255, 102, 170, 28))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(60))).convert("RGB")
    draw = ImageDraw.Draw(canvas, "RGBA")

    # Logo
    logo = Image.open(ASSETS / "roxy.png").convert("RGBA")
    logo = logo.resize((112, 112), Image.Resampling.LANCZOS)
    mask = Image.new("L", logo.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, logo.size[0] - 1, logo.size[1] - 1), fill=255)
    logo.putalpha(mask)
    canvas.paste(logo, (72, 168), logo)

    title_font = load_font(72, bold=True)
    tag_font = load_font(28, bold=False)
    draw.text((208, 178), "Roxysu", fill="#f4f4f4", font=title_font)

    tagline = "Local-first practice analytics\nfor osu!lazer"
    draw.multiline_text((72, 310), tagline, fill="#a7a7a7", font=tag_font, spacing=8)

    # Screenshot panel on the right — full replay UI (playfield + analysis)
    shot = Image.open(SHOT).convert("RGB")
    sw, sh = shot.size
    # Prefer the main content band (skip a bit of bottom chrome)
    crop = shot.crop((0, int(sh * 0.02), sw, int(sh * 0.88)))
    target_w, target_h = 640, 460
    crop_ratio = crop.width / crop.height
    panel_ratio = target_w / target_h
    if crop_ratio > panel_ratio:
        new_h = crop.height
        new_w = int(new_h * panel_ratio)
        # Bias right so the analysis sidebar stays visible
        left = min(crop.width - new_w, int((crop.width - new_w) * 0.55))
        crop = crop.crop((left, 0, left + new_w, new_h))
    else:
        new_w = crop.width
        new_h = int(new_w / panel_ratio)
        top = max(0, int((crop.height - new_h) * 0.15))
        crop = crop.crop((0, top, new_w, top + new_h))
    crop = crop.resize((target_w, target_h), Image.Resampling.LANCZOS)

    radius = 18
    panel = Image.new("RGBA", (target_w + 4, target_h + 4), (0, 0, 0, 0))
    border = Image.new("RGBA", panel.size, (255, 255, 255, 28))
    border.putalpha(rounded_mask(panel.size, radius + 1))
    inner = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    inner.paste(crop, (0, 0))
    inner.putalpha(rounded_mask((target_w, target_h), radius))
    panel.paste(border, (0, 0), border)
    panel.paste(inner, (2, 2), inner)

    # Soft shadow
    shadow = Image.new("RGBA", (panel.width + 40, panel.height + 40), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle((20, 24, 20 + panel.width, 24 + panel.height), radius=radius + 2, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas_rgba = canvas.convert("RGBA")
    px, py = 520, 85
    canvas_rgba.alpha_composite(shadow, (px - 20, py - 16))
    canvas_rgba.alpha_composite(panel, (px, py))

    canvas_rgba.convert("RGB").save(OUT, format="PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
