from __future__ import annotations

import os
from functools import lru_cache

from PIL import Image

from .image_utils import crop_bbox
from .knowledge import build_card, normalize_label


def _env_enabled(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _center_weight(bbox: list[float]) -> float:
    x, y, width, height = bbox
    cx = x + width / 2
    cy = y + height / 2
    distance = ((cx - 0.5) ** 2 + (cy - 0.5) ** 2) ** 0.5
    area = width * height
    return area * 1.8 + max(0.0, 0.8 - distance)


@lru_cache(maxsize=1)
def get_yolo_model():
    from ultralytics import YOLO

    return YOLO(os.getenv("YOLO_MODEL", "yolov8n.pt"))


@lru_cache(maxsize=1)
def get_classifier():
    from transformers import pipeline

    model_name = os.getenv("CLASSIFIER_MODEL", "microsoft/resnet-50")
    device = int(os.getenv("MODEL_DEVICE", "-1"))
    return pipeline("image-classification", model=model_name, device=device)


def detect_primary_object(image: Image.Image) -> tuple[Image.Image, list[dict], str | None, float]:
    result = get_yolo_model()(image, verbose=False)[0]
    detections: list[dict] = []
    names = result.names

    for box in result.boxes:
        confidence = float(box.conf[0])
        if confidence < float(os.getenv("YOLO_CONFIDENCE", "0.25")):
            continue

        cls_id = int(box.cls[0])
        label = normalize_label(str(names.get(cls_id, cls_id)))
        x1, y1, x2, y2 = [float(value) for value in box.xyxy[0]]
        image_width, image_height = image.size
        bbox = [
            max(0.0, min(1.0, x1 / image_width)),
            max(0.0, min(1.0, y1 / image_height)),
            max(0.01, min(1.0, (x2 - x1) / image_width)),
            max(0.01, min(1.0, (y2 - y1) / image_height)),
        ]
        detections.append(
            {
                "label": label,
                "confidence": round(confidence, 4),
                "bbox": [round(value, 4) for value in bbox],
                "score": _center_weight(bbox) * max(0.2, confidence),
            }
        )

    if not detections:
        return image, [], None, 0.0

    primary = sorted(detections, key=lambda item: item["score"], reverse=True)[0]
    crop = crop_bbox(image, primary["bbox"])
    public_detections = [{key: value for key, value in item.items() if key != "score"} for item in detections]
    return crop, public_detections, primary["label"], primary["confidence"]


def classify(image: Image.Image) -> list[dict]:
    if not _env_enabled("ENABLE_CLASSIFIER"):
        return []

    raw_results = get_classifier()(image, top_k=int(os.getenv("CLASSIFIER_TOP_K", "5")))
    return [{"label": normalize_label(str(item["label"])), "score": float(item["score"])} for item in raw_results]


def identify_image(image: Image.Image) -> dict:
    crop, detections, detector_label, detector_confidence = detect_primary_object(image)
    classifications = classify(crop)
    classifier_top = classifications[0] if classifications else {"label": detector_label or "object", "score": detector_confidence}
    classifier_label = classifier_top["label"]
    classifier_confidence = float(classifier_top["score"])

    if detector_label and detector_label in classifier_label:
        label = classifier_label
        confidence = max(detector_confidence, classifier_confidence)
    elif detector_label and detector_confidence >= classifier_confidence + 0.12:
        label = detector_label
        confidence = detector_confidence
    else:
        label = classifier_label
        confidence = classifier_confidence

    visual_clues = []
    if detector_label:
        visual_clues.append(f"Detector located a primary {detector_label} in the frame.")
    if classifications:
        visual_clues.extend(f"Classifier candidate: {item['label']} ({round(item['score'] * 100)}%)." for item in classifications[:3])
    else:
        visual_clues.append("Running in low-memory detector-only mode.")
    alternatives = [{"label": item["label"], "confidence": round(float(item["score"]), 4), "source": "classifier"} for item in classifications[:5]]

    return build_card(label=label, confidence=confidence, visual_clues=visual_clues, detections=detections, alternatives=alternatives)
