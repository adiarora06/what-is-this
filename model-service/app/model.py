from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import requests
from PIL import Image

from .knowledge import build_card, normalize_label

MODEL_URL = "https://github.com/onnx/models/raw/main/validated/vision/classification/mobilenet/model/mobilenetv2-7.onnx"
LABELS_URL = "https://raw.githubusercontent.com/pytorch/hub/master/imagenet_classes.txt"


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


def _preprocess(image: Image.Image) -> np.ndarray:
    image = image.convert("RGB")
    image.thumbnail((256, 256))
    canvas = Image.new("RGB", (256, 256), (0, 0, 0))
    canvas.paste(image, ((256 - image.width) // 2, (256 - image.height) // 2))
    left = (256 - 224) // 2
    image = canvas.crop((left, left, left + 224, left + 224))

    array = np.asarray(image).astype("float32") / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype="float32")
    std = np.array([0.229, 0.224, 0.225], dtype="float32")
    array = (array - mean) / std
    return np.transpose(array, (2, 0, 1))[None, ...]


def classify(image: Image.Image) -> list[dict]:
    session = get_classifier_session()
    labels = get_labels()
    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: _preprocess(image)})[0]
    scores = _softmax(np.asarray(output).reshape(-1))
    top_k = min(int(os.getenv("CLASSIFIER_TOP_K", "5")), len(scores))
    indices = np.argsort(scores)[-top_k:][::-1]
    return [{"label": labels[int(index)], "score": float(scores[int(index)])} for index in indices]


def identify_image(image: Image.Image) -> dict:
    classifications = classify(image)
    top = classifications[0] if classifications else {"label": "object", "score": 0.0}
    label = top["label"]
    confidence = float(top["score"])
    visual_clues = [
        "Classifier-only mode is active for low-memory hosting.",
        f"Top ImageNet match: {label} ({round(confidence * 100)}%).",
    ]
    alternatives = [{"label": item["label"], "confidence": round(float(item["score"]), 4), "source": "classifier"} for item in classifications[:5]]

    return build_card(label=label, confidence=confidence, visual_clues=visual_clues, detections=[], alternatives=alternatives)
