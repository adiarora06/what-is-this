from __future__ import annotations

import base64
import io

from PIL import Image, ImageOps


def image_from_data_url(data_url: str) -> Image.Image:
    if not data_url.startswith("data:image/"):
        raise ValueError("Expected a data:image/... URL.")

    try:
        _, encoded = data_url.split(",", 1)
    except ValueError as exc:
        raise ValueError("Image data URL is missing base64 payload.") from exc

    raw = base64.b64decode(encoded)
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    return image.convert("RGB")


def crop_bbox(image: Image.Image, bbox: list[float], padding: float = 0.12) -> Image.Image:
    width, height = image.size
    x, y, box_width, box_height = bbox
    left = max(0, int((x - box_width * padding) * width))
    top = max(0, int((y - box_height * padding) * height))
    right = min(width, int((x + box_width + box_width * padding) * width))
    bottom = min(height, int((y + box_height + box_height * padding) * height))
    if right <= left or bottom <= top:
        return image
    return image.crop((left, top, right, bottom))

