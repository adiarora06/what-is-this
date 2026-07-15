# What Is This CV Model Service

This backend identifies objects without sending images to GPT.

It uses:

- YOLO for detection and primary-object cropping.
- A trained image classifier for finer labels.
- Deterministic metadata generation for about/use/care/purchase fields.

## Local Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Warmup:

```bash
curl -X POST http://127.0.0.1:8010/warmup
```

## Environment

```text
YOLO_MODEL=yolov8n.pt
CLASSIFIER_MODEL=microsoft/resnet-50
ENABLE_CLASSIFIER=false
MODEL_DEVICE=-1
YOLO_CONFIDENCE=0.25
CLASSIFIER_TOP_K=5
ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
VISION_BACKEND_TOKEN=long-random-token
```

Set the same `VISION_BACKEND_TOKEN` in Vercel so only your app can call the backend.

The default Render configuration runs in detector-only mode to reduce memory.
For higher accuracy on a larger paid instance, you can enable the classifier and switch back to larger models:

```text
YOLO_MODEL=yolov8x.pt
CLASSIFIER_MODEL=facebook/convnext-base-224-22k-1k
ENABLE_CLASSIFIER=true
```
