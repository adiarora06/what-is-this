from __future__ import annotations

import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .image_utils import image_from_data_url
from .model import get_classifier, get_yolo_model, identify_image
from .schemas import IdentifyRequest, IdentifyResponse

app = FastAPI(title="What Is This CV Model Service", version="0.1.0")

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


def verify_token(authorization: str | None) -> None:
    expected_token = os.getenv("VISION_BACKEND_TOKEN")
    if not expected_token:
        return
    if authorization != f"Bearer {expected_token}":
        raise HTTPException(status_code=401, detail="Invalid vision backend token.")


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "yolo_model": os.getenv("YOLO_MODEL", "yolov8x.pt"),
        "classifier_model": os.getenv("CLASSIFIER_MODEL", "facebook/convnext-base-224-22k-1k"),
    }


@app.post("/warmup")
def warmup(authorization: str | None = Header(default=None)) -> dict:
    verify_token(authorization)
    get_yolo_model()
    get_classifier()
    return {"ok": True, "message": "Model weights are loaded."}


@app.post("/identify", response_model=IdentifyResponse)
def identify(payload: IdentifyRequest, authorization: str | None = Header(default=None)) -> dict:
    verify_token(authorization)
    try:
        image = image_from_data_url(payload.image)
        card = identify_image(image)
        return {
            "ok": True,
            "card": card,
            "model": (
                f"YOLO={os.getenv('YOLO_MODEL', 'yolov8x.pt')} + "
                f"classifier={os.getenv('CLASSIFIER_MODEL', 'facebook/convnext-base-224-22k-1k')}"
            ),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

