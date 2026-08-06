from __future__ import annotations

from pydantic import BaseModel, Field


class IdentifyRequest(BaseModel):
    image: str = Field(
        min_length=32,
        max_length=4_100_000,
        pattern=r"^data:image/(jpeg|png|webp);base64,",
        description="JPEG, PNG, or WebP base64 data URL up to 3 MB decoded",
    )
    context: str | None = Field(default=None, max_length=500)


class PurchaseLink(BaseModel):
    label: str
    url: str


class DetectionResult(BaseModel):
    label: str
    confidence: float
    bbox: list[float]


class AlternativeResult(BaseModel):
    label: str
    confidence: float
    source: str = "classifier"


class IdentifyCard(BaseModel):
    objectName: str
    shortName: str
    confidence: float
    category: str
    about: str
    visualClues: list[str]
    useCases: list[str]
    careTips: list[str]
    purchaseQuery: str
    purchaseLinks: list[PurchaseLink] = []
    shoppingRecommended: bool = True
    safetyNote: str | None = None
    detections: list[DetectionResult] = []
    alternatives: list[AlternativeResult] = []
    source: str = "cv-backend"


class IdentifyResponse(BaseModel):
    ok: bool
    card: IdentifyCard
    model: str
