from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
BACKGROUND = (244, 241, 232, 255)
GREEN = (5, 150, 105, 255)
INK_LIGHT = (247, 245, 239, 255)
SCALE = 4
SOURCE = ROOT / "assets" / "generated" / "launcher-icon-source.png"


def load_generated_icon() -> Image.Image:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Missing Niu Image Gen source asset: {SOURCE}")

    with Image.open(SOURCE) as source:
        rgba = source.convert("RGBA")
        side = min(rgba.size)
        return ImageOps.fit(
            rgba,
            (side, side),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        )


def generated_icon(size: int, *, round_mask: bool = False) -> Image.Image:
    source = load_generated_icon().resize(
        (size, size),
        Image.Resampling.LANCZOS,
    )
    if not round_mask:
        return source

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    source.putalpha(mask)
    return source


def draw_mark(
    size: int,
    *,
    transparent: bool = False,
    round_background: bool = False,
) -> Image.Image:
    canvas_size = size * SCALE
    image = Image.new(
        "RGBA",
        (canvas_size, canvas_size),
        (0, 0, 0, 0) if transparent or round_background else BACKGROUND,
    )
    draw = ImageDraw.Draw(image)

    if round_background:
        draw.ellipse((0, 0, canvas_size - 1, canvas_size - 1), fill=BACKGROUND)

    def box(
        left: float,
        top: float,
        right: float,
        bottom: float,
    ) -> tuple[int, int, int, int]:
        return tuple(
            round(value * canvas_size)
            for value in (left, top, right, bottom)
        )

    draw.rounded_rectangle(
        box(0.26, 0.23, 0.74, 0.78),
        radius=round(canvas_size * 0.075),
        fill=GREEN,
    )
    draw.rectangle(box(0.26, 0.35, 0.74, 0.42), fill=INK_LIGHT)
    draw.rounded_rectangle(
        box(0.36, 0.17, 0.42, 0.33),
        radius=round(canvas_size * 0.02),
        fill=INK_LIGHT,
    )
    draw.rounded_rectangle(
        box(0.58, 0.17, 0.64, 0.33),
        radius=round(canvas_size * 0.02),
        fill=INK_LIGHT,
    )

    check = [
        (round(canvas_size * 0.37), round(canvas_size * 0.59)),
        (round(canvas_size * 0.47), round(canvas_size * 0.69)),
        (round(canvas_size * 0.66), round(canvas_size * 0.49)),
    ]
    stroke = max(2, round(canvas_size * 0.055))
    draw.line(check, fill=INK_LIGHT, width=stroke, joint="curve")
    for point in check:
        radius = stroke // 2
        draw.ellipse(
            (
                point[0] - radius,
                point[1] - radius,
                point[0] + radius,
                point[1] + radius,
            ),
            fill=INK_LIGHT,
        )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def draw_splash(width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height), BACKGROUND)
    mark_size = max(96, round(min(width, height) * 0.26))
    mark = generated_icon(mark_size)
    mask = Image.new("L", (mark_size, mark_size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, mark_size - 1, mark_size - 1),
        radius=round(mark_size * 0.2),
        fill=255,
    )
    mark.putalpha(mask)
    image.alpha_composite(
        mark,
        ((width - mark_size) // 2, (height - mark_size) // 2),
    )
    return image


def main() -> None:
    densities = {
        "mdpi": (48, 108),
        "hdpi": (72, 162),
        "xhdpi": (96, 216),
        "xxhdpi": (144, 324),
        "xxxhdpi": (192, 432),
    }

    for density, (launcher_size, foreground_size) in densities.items():
        folder = RES / f"mipmap-{density}"
        generated_icon(launcher_size).save(folder / "ic_launcher.png")
        generated_icon(launcher_size, round_mask=True).save(
            folder / "ic_launcher_round.png"
        )
        generated_icon(foreground_size).save(
            folder / "ic_launcher_foreground.png"
        )

    splash_paths = {
        RES / "drawable" / "splash.png": (480, 320),
        RES / "drawable-land-mdpi" / "splash.png": (480, 320),
        RES / "drawable-land-hdpi" / "splash.png": (800, 480),
        RES / "drawable-land-xhdpi" / "splash.png": (1280, 720),
        RES / "drawable-land-xxhdpi" / "splash.png": (1600, 960),
        RES / "drawable-land-xxxhdpi" / "splash.png": (1920, 1280),
        RES / "drawable-port-mdpi" / "splash.png": (320, 480),
        RES / "drawable-port-hdpi" / "splash.png": (480, 800),
        RES / "drawable-port-xhdpi" / "splash.png": (720, 1280),
        RES / "drawable-port-xxhdpi" / "splash.png": (960, 1600),
        RES / "drawable-port-xxxhdpi" / "splash.png": (1280, 1920),
    }
    for path, size in splash_paths.items():
        draw_splash(*size).save(path)

    public = ROOT / "public"
    public.mkdir(exist_ok=True)
    generated_icon(192).save(public / "icon-192.png")


if __name__ == "__main__":
    main()
