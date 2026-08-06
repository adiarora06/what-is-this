from __future__ import annotations

import hmac
import logging
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .image_utils import image_from_data_url
from .model import get_classifier_session, get_labels, identify_image
from .schemas import IdentifyRequest, IdentifyResponse

app = FastAPI(title="What Is This CV Model Service", version="0.1.0")
logger = logging.getLogger(__name__)

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
    expected_token = os.getenv("VISION_BACKEND_TOKEN", "").strip()
    if len(expected_token) < 24:
        raise HTTPException(status_code=503, detail="Vision backend authentication is not configured.")

    scheme, _, supplied_token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(supplied_token, expected_token):
        raise HTTPException(status_code=401, detail="Invalid vision backend token.")


@app.get("/health", response_model=None)
def health():
    authentication_configured = len(os.getenv("VISION_BACKEND_TOKEN", "").strip()) >= 24
    payload = {
        "ok": authentication_configured,
        "mode": "classifier-only",
        "classifier_model": "mobilenetv2-7.onnx",
        "authentication_configured": authentication_configured,
    }
    return payload if authentication_configured else JSONResponse(status_code=503, content=payload)


@app.get("/")
def root() -> dict:
    return {"ok": True, "service": "What Is This CV Model Service", "health": "/health"}


@app.post("/warmup")
def warmup(authorization: str | None = Header(default=None)) -> dict:
    verify_token(authorization)
    get_classifier_session()
    get_labels()
    return {"ok": True, "message": "Model weights are loaded."}


@app.post("/identify", response_model=IdentifyResponse)
def identify(payload: IdentifyRequest, authorization: str | None = Header(default=None)) -> dict:
    verify_token(authorization)
    try:
        image = image_from_data_url(payload.image)
        card = identify_image(image, payload.context)
        return {
            "ok": True,
            "card": card,
            "model": "classifier=mobilenetv2-7.onnx",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Vision identification failed")
        raise HTTPException(status_code=500, detail="Vision identification failed.") from exc
