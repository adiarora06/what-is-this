from __future__ import annotations

from urllib.parse import quote_plus

NORMALIZED_LABELS = {
    "cellular telephone": "smartphone",
    "mobile phone": "smartphone",
    "notebook": "notebook computer",
    "laptop": "laptop computer",
    "water bottle": "bottle",
    "coffee mug": "mug",
}

CATEGORY_RULES = {
    "electronics": ["phone", "smartphone", "laptop", "computer", "keyboard", "mouse", "remote", "camera", "speaker", "tablet"],
    "kitchen": ["cup", "mug", "bottle", "plate", "spoon", "fork", "knife", "bowl", "pan", "kettle"],
    "bag": ["backpack", "handbag", "purse", "suitcase", "wallet", "bag"],
    "furniture": ["chair", "table", "sofa", "couch", "desk", "cabinet", "lamp"],
    "clothing": ["shoe", "shirt", "jacket", "hat", "watch", "sunglasses", "glasses"],
    "sports": ["ball", "racket", "helmet", "bat", "skateboard", "bicycle"],
}

USE_CASES = {
    "electronics": ["Communication or productivity", "Media, work, or control tasks", "Everyday personal or office use"],
    "kitchen": ["Food or drink preparation", "Serving, storing, or carrying consumables", "Home, office, or travel use"],
    "bag": ["Carrying daily essentials", "Travel, school, office, or commuting", "Keeping items organized"],
    "furniture": ["Supporting work, rest, storage, or display", "Organizing a room", "Creating a usable living or work area"],
    "clothing": ["Personal wear", "Protection, comfort, or style", "Daily routines and travel"],
    "sports": ["Training, recreation, or competition", "Fitness and skill practice", "Team or solo activity"],
    "general object": ["Everyday use", "Storage, display, work, repair, or household tasks", "Depends on the specific version and material"],
}

CARE_TIPS = {
    "electronics": ["Keep it dry", "Avoid heat and hard impacts", "Use the correct charger or accessories"],
    "kitchen": ["Wash after use", "Check whether it is dishwasher safe", "Avoid abrasive cleaning if the finish matters"],
    "bag": ["Empty and clean pockets regularly", "Avoid overloading seams and zippers", "Store dry to prevent odor or mildew"],
    "furniture": ["Wipe dust regularly", "Avoid dragging across floors", "Keep away from excess moisture"],
    "clothing": ["Check the care label", "Store clean and dry", "Avoid unnecessary heat if fabric is delicate"],
    "sports": ["Inspect before use", "Clean after heavy activity", "Store away from moisture and direct sun"],
    "general object": ["Keep it clean and dry", "Store it safely", "Check manufacturer care guidance if available"],
}


def normalize_label(label: str) -> str:
    cleaned = label.replace("_", " ").split(",")[0].strip().lower()
    return NORMALIZED_LABELS.get(cleaned, cleaned)


def title_label(label: str) -> str:
    small_words = {"of", "and", "or", "the", "a", "an"}
    words = label.split()
    return " ".join(word if index and word in small_words else word.capitalize() for index, word in enumerate(words))


def category_for(label: str) -> str:
    for category, needles in CATEGORY_RULES.items():
        if any(needle in label for needle in needles):
            return category
    return "general object"


def purchase_links(query: str) -> list[dict]:
    encoded = quote_plus(query)
    return [
        {"label": "Google Shopping", "url": f"https://www.google.com/search?tbm=shop&q={encoded}"},
        {"label": "Amazon", "url": f"https://www.amazon.com/s?k={encoded}"},
        {"label": "eBay", "url": f"https://www.ebay.com/sch/i.html?_nkw={encoded}"},
    ]


def build_card(label: str, confidence: float, visual_clues: list[str], detections: list[dict], alternatives: list[dict] | None = None) -> dict:
    normalized = normalize_label(label)
    category = category_for(normalized)
    name = title_label(normalized)
    about = (
        f"I look like a {normalized}. I am recognized from my shape, materials, and visible details, "
        "and I am usually used as a practical everyday item."
    )

    return {
        "objectName": name,
        "shortName": name,
        "confidence": round(max(0.0, min(1.0, confidence)), 4),
        "category": category,
        "about": about,
        "visualClues": visual_clues[:5],
        "useCases": USE_CASES.get(category, USE_CASES["general object"]),
        "careTips": CARE_TIPS.get(category, CARE_TIPS["general object"]),
        "purchaseQuery": normalized,
        "purchaseLinks": purchase_links(normalized),
        "safetyNote": None,
        "detections": detections,
        "alternatives": alternatives or [],
        "source": "cv-backend",
    }

