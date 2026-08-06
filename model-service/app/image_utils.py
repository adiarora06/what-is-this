from __future__ import annotations

import base64
import binascii
import io
import re
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_IMAGE_BYTES = 3_000_000
MAX_IMAGE_DIMENSION = 8_000
MAX_IMAGE_PIXELS = 20_000_000
DATA_URL_PATTERN = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$", re.IGNORECASE)
EXPECTED_FORMAT = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}


def image_from_data_url(data_url: str) -> Image.Image:
    match = DATA_URL_PATTERN.fullmatch(data_url)
    if not match:
        raise ValueError("Use a valid JPEG, PNG, or WebP image.")

    mime_type = match.group(1).lower()
    encoded = match.group(2).replace("\r", "").replace("\n", "")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Image data is not valid base64.") from exc

    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("Image must be smaller than 3 MB.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            probe = Image.open(io.BytesIO(raw))
            width, height = probe.size
            image_format = probe.format
            probe.verify()
    except (Image.DecompressionBombWarning, Image.DecompressionBombError, UnidentifiedImageError, OSError) as exc:
        raise ValueError("Image could not be safely decoded.") from exc

    if image_format != EXPECTED_FORMAT[mime_type]:
        raise ValueError("Image content does not match its declared file type.")
    if width <= 0 or height <= 0 or max(width, height) > MAX_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS:
        raise ValueError("Image dimensions are too large.")

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        return ImageOps.exif_transpose(image).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Image could not be safely decoded.") from exc


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
