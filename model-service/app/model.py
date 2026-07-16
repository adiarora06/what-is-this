from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageOps

from .knowledge import build_card, category_for, normalize_label

MODEL_URL = "https://github.com/onnx/models/raw/main/validated/vision/classification/mobilenet/model/mobilenetv2-7.onnx"
LABELS_URL = "https://raw.githubusercontent.com/pytorch/hub/master/imagenet_classes.txt"
RESAMPLE = Image.Resampling.BILINEAR
IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype="float32")
IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype="float32")


def _cache_dir() -> Path:
    path = Path(os.getenv("MODEL_CACHE_DIR", "/tmp/what-is-this-models"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _download_file(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size > 1024:
        return

    response = requests.get(url, timeout=60)
    response.raise_for_status()
    path.write_bytes(response.content)


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values)
    exp = np.exp(shifted)
    return exp / np.sum(exp)


def _context_tokens(context: str | None) -> set[str]:
    if not context:
        return set()
    return {token for token in re.findall(r"[a-z0-9]+", context.lower()) if len(token) > 2}


def _context_multiplier(label: str, context_tokens: set[str]) -> float:
    if not context_tokens:
        return 1.0

    label_tokens = set(re.findall(r"[a-z0-9]+", label.lower()))
    overlap = label_tokens & context_tokens
    multiplier = 1.0 + min(0.2, 0.07 * len(overlap))

    category = category_for(label)
    if category in context_tokens:
        multiplier += 0.12

    category_aliases = {
        "electronics": {"tech", "device", "gadget", "office", "computer"},
        "kitchen": {"food", "drink", "cooking", "restaurant", "cup"},
        "bag": {"travel", "school", "carry", "commute"},
        "furniture": {"home", "room", "desk", "office"},
        "clothing": {"wear", "fashion", "outfit", "shoe"},
        "sports": {"sport", "fitness", "game", "outdoor"},
    }
    if category_aliases.get(category, set()) & context_tokens:
        multiplier += 0.08

    return multiplier


@lru_cache(maxsize=1)
def get_classifier_session():
    import onnxruntime as ort

    model_path = _cache_dir() / "mobilenetv2-7.onnx"
    _download_file(os.getenv("ONNX_MODEL_URL", MODEL_URL), model_path)
    options = ort.SessionOptions()
    options.intra_op_num_threads = int(os.getenv("ONNX_THREADS", "1"))
    options.inter_op_num_threads = int(os.getenv("ONNX_THREADS", "1"))
    return ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])


@lru_cache(maxsize=1)
def get_labels() -> list[str]:
    labels_path = _cache_dir() / "imagenet_classes.txt"
    _download_file(os.getenv("IMAGENET_LABELS_URL", LABELS_URL), labels_path)
    labels = [normalize_label(line) for line in labels_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(labels) < 1000:
        raise RuntimeError("ImageNet labels file did not contain the expected classes.")
    return labels


def _resize_short_side(image: Image.Image, short_side: int = 256) -> Image.Image:
    width, height = image.size
    scale = short_side / max(1, min(width, height))
    return image.resize((round(width * scale), round(height * scale)), RESAMPLE)


def _anchored_crop(image: Image.Image, anchor: str) -> Image.Image:
    width, height = image.size
    crop_size = min(224, width, height)
    if anchor == "top-left":
        left, top = 0, 0
    elif anchor == "top-right":
        left, top = width - crop_size, 0
    elif anchor == "bottom-left":
        left, top = 0, height - crop_size
    elif anchor == "bottom-right":
        left, top = width - crop_size, height - crop_size
    else:
        left, top = (width - crop_size) // 2, (height - crop_size) // 2

    crop = image.crop((left, top, left + crop_size, top + crop_size))
    return crop.resize((224, 224), RESAMPLE) if crop_size != 224 else crop


def _center_fraction_crop(image: Image.Image, fraction: float) -> Image.Image:
    width, height = image.size
    crop_width = max(1, round(width * fraction))
    crop_height = max(1, round(height * fraction))
    left = (width - crop_width) // 2
    top = (height - crop_height) // 2
    return image.crop((left, top, left + crop_width, top + crop_height))


def _largest_center_square(image: Image.Image) -> Image.Image:
    width, height = image.size
    crop_size = min(width, height)
    left = (width - crop_size) // 2
    top = (height - crop_size) // 2
    return image.crop((left, top, left + crop_size, top + crop_size))


def _contained_square(image: Image.Image) -> Image.Image:
    contained = ImageOps.contain(image, (224, 224), method=RESAMPLE)
    canvas_color = tuple(int(value * 255) for value in IMAGE_MEAN)
    canvas = Image.new("RGB", (224, 224), canvas_color)
    canvas.paste(contained, ((224 - contained.width) // 2, (224 - contained.height) // 2))
    return canvas


def _classifier_views(image: Image.Image) -> list[tuple[str, Image.Image, float]]:
    image = image.convert("RGB")
    resized = _resize_short_side(image)
    views: list[tuple[str, Image.Image, float]] = [
        ("full-frame contained crop", _contained_square(image), 1.7),
        ("standard center crop", _anchored_crop(resized, "center"), 0.6),
        ("largest center-square crop", _anchored_crop(_resize_short_side(_largest_center_square(image)), "center"), 0.5),
        ("object-guide center crop", _anchored_crop(_resize_short_side(_center_fraction_crop(image, 0.76)), "center"), 0.25),
        ("top-left context crop", _anchored_crop(resized, "top-left"), 0.15),
        ("top-right context crop", _anchored_crop(resized, "top-right"), 0.15),
        ("bottom-left context crop", _anchored_crop(resized, "bottom-left"), 0.15),
        ("bottom-right context crop", _anchored_crop(resized, "bottom-right"), 0.15),
    ]
    return views[: max(1, int(os.getenv("CLASSIFIER_VIEWS", "3")))]


def _preprocess(image: Image.Image) -> np.ndarray:
    array = np.asarray(image).astype("float32") / 255.0
    array = (array - IMAGE_MEAN) / IMAGE_STD
    return np.transpose(array, (2, 0, 1))[None, ...]


def classify(image: Image.Image, context: str | None = None) -> tuple[list[dict], int, bool]:
    session = get_classifier_session()
    labels = get_labels()
    input_name = session.get_inputs()[0].name
    context_tokens = _context_tokens(context)
    views = _classifier_views(image)
    weighted_scores: np.ndarray | None = None
    total_weight = 0.0

    for _name, view, weight in views:
        output = session.run(None, {input_name: _preprocess(view)})[0]
        scores = _softmax(np.asarray(output).reshape(-1)).astype("float32")
        weighted_scores = scores * weight if weighted_scores is None else weighted_scores + scores * weight
        total_weight += weight

    if weighted_scores is None:
        return [], 0, False

    scores = weighted_scores / max(total_weight, 0.0001)
    used_context = bool(context_tokens)
    if used_context:
        multipliers = np.array([_context_multiplier(label, context_tokens) for label in labels], dtype="float32")
        scores = scores * multipliers
        scores = scores / np.sum(scores)

    top_k = min(int(os.getenv("CLASSIFIER_TOP_K", "5")), len(scores))
    indices = np.argsort(scores)[-top_k:][::-1]
    return [{"label": labels[int(index)], "score": float(scores[int(index)])} for index in indices], len(views), used_context


def identify_image(image: Image.Image, context: str | None = None) -> dict:
    classifications, view_count, used_context = classify(image, context)
    top = classifications[0] if classifications else {"label": "object", "score": 0.0}
    label = top["label"]
    confidence = float(top["score"])
    visual_clues = [
        f"Classifier-only mode averaged {view_count} lightweight image views.",
        f"Top ImageNet match: {label} ({round(confidence * 100)}%).",
    ]
    if used_context:
        visual_clues.append("Optional context was used to rerank close classifier matches.")

    alternatives = [{"label": item["label"], "confidence": round(float(item["score"]), 4), "source": "classifier"} for item in classifications[:5]]

    return build_card(label=label, confidence=confidence, visual_clues=visual_clues, detections=[], alternatives=alternatives)
