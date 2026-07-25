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

# Standard ImageNet-1K ordering groups animals and other living creatures first.
ANIMAL_CLASS_INDEX_MAX = 397

CATEGORY_RULES = {
    "electronics": ["phone", "smartphone", "laptop", "computer", "keyboard", "mouse", "remote", "camera", "speaker", "tablet"],
    "kitchen": ["cup", "mug", "bottle", "plate", "spoon", "fork", "knife", "bowl", "pan", "kettle"],
    "bag": ["backpack", "handbag", "purse", "suitcase", "wallet", "bag"],
    "furniture": ["chair", "table", "sofa", "couch", "desk", "cabinet", "lamp"],
    "clothing": ["shoe", "shirt", "jacket", "hat", "watch", "sunglasses", "glasses"],
    "sports": ["ball", "racket", "helmet", "bat", "skateboard", "bicycle"],
    "tool": ["hammer", "screwdriver", "wrench", "drill", "saw", "tool"],
    "book": ["book", "comic", "notebook"],
    "toy": ["toy", "doll", "puzzle", "teddy"],
    "vehicle accessory": ["car mirror", "seat belt", "odometer", "speedometer"],
}

SHOPPABLE_CATEGORIES = {"electronics", "kitchen", "bag", "furniture", "clothing", "sports", "tool", "book", "toy", "vehicle accessory"}

USE_CASES = {
    "animal": ["Breed or species recognition", "Pet, wildlife, or educational reference", "Visual comparison with similar animals"],
    "electronics": ["Communication or productivity", "Media, work, or control tasks", "Everyday personal or office use"],
    "kitchen": ["Food or drink preparation", "Serving, storing, or carrying consumables", "Home, office, or travel use"],
    "bag": ["Carrying daily essentials", "Travel, school, office, or commuting", "Keeping items organized"],
    "furniture": ["Supporting work, rest, storage, or display", "Organizing a room", "Creating a usable living or work area"],
    "clothing": ["Personal wear", "Protection, comfort, or style", "Daily routines and travel"],
    "sports": ["Training, recreation, or competition", "Fitness and skill practice", "Team or solo activity"],
    "tool": ["Building or repair work", "Maintenance tasks", "Workshop or household projects"],
    "book": ["Reading and reference", "Learning or entertainment", "Collection or study"],
    "toy": ["Play and recreation", "Learning or skill practice", "Display or collection"],
    "vehicle accessory": ["Vehicle operation or maintenance", "Safety or convenience", "Replacement or repair reference"],
    "general object": ["Use depends on the exact item", "Compare the result with the alternative matches", "Add context or correct the label to improve future results"],
}

CARE_TIPS = {
    "animal": ["Treat this breed or species result as a visual estimate", "Use a qualified professional for health or safety questions", "Approach unfamiliar animals cautiously"],
    "electronics": ["Keep it dry", "Avoid heat and hard impacts", "Use the correct charger or accessories"],
    "kitchen": ["Wash after use", "Check whether it is dishwasher safe", "Avoid abrasive cleaning if the finish matters"],
    "bag": ["Empty and clean pockets regularly", "Avoid overloading seams and zippers", "Store dry to prevent odor or mildew"],
    "furniture": ["Wipe dust regularly", "Avoid dragging across floors", "Keep away from excess moisture"],
    "clothing": ["Check the care label", "Store clean and dry", "Avoid unnecessary heat if fabric is delicate"],
    "sports": ["Inspect before use", "Clean after heavy activity", "Store away from moisture and direct sun"],
    "tool": ["Inspect before use", "Follow the manufacturer's safety guidance", "Store clean, dry, and out of children's reach"],
    "book": ["Keep dry", "Avoid prolonged direct sunlight", "Store upright or flat with support"],
    "toy": ["Check age and safety guidance", "Inspect for loose or damaged parts", "Clean according to the material"],
    "vehicle accessory": ["Confirm compatibility before purchase or installation", "Follow vehicle safety guidance", "Use a qualified technician for safety-critical parts"],
    "general object": ["Confirm the label before following care guidance", "Keep it clean and dry when appropriate", "Check manufacturer guidance if available"],
}


def normalize_label(label: str) -> str:
    cleaned = label.replace("_", " ").split(",")[0].strip().lower()
    return NORMALIZED_LABELS.get(cleaned, cleaned)


def title_label(label: str) -> str:
    small_words = {"of", "and", "or", "the", "a", "an"}
    words = label.split()
    return " ".join(word if index and word in small_words else word.capitalize() for index, word in enumerate(words))


def category_for(label: str, class_index: int | None = None) -> str:
    if class_index is not None and 0 <= class_index <= ANIMAL_CLASS_INDEX_MAX:
        return "animal"
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


def build_card(
    label: str,
    confidence: float,
    visual_clues: list[str],
    detections: list[dict],
    alternatives: list[dict] | None = None,
    class_index: int | None = None,
) -> dict:
    normalized = normalize_label(label)
    category = category_for(normalized, class_index)
    name = title_label(normalized)
    shopping_recommended = category in SHOPPABLE_CATEGORIES

    if category == "animal":
        about = f"This animal most closely matches a {normalized}. The result is a visual breed or species estimate, not a verified identification."
        safety_note = "Do not rely on visual identification alone for veterinary, wildlife, or personal-safety decisions."
    elif category == "general object":
        about = f"The compact classifier's closest visual match is {normalized}. Check the alternative matches or add context because this model only knows a limited set of labels."
        safety_note = None
    else:
        about = f"I appear to be a {normalized}. My visible shape and details most closely match this everyday product category."
        safety_note = None

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
        "purchaseLinks": purchase_links(normalized) if shopping_recommended else [],
        "shoppingRecommended": shopping_recommended,
        "safetyNote": safety_note,
        "detections": detections,
        "alternatives": alternatives or [],
        "source": "cv-backend",
    }
