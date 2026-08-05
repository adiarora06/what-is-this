# What Is This CV Model Service

This backend identifies objects without sending images to GPT.

It uses:

- ONNX Runtime with a small MobileNetV2 ImageNet classifier.
- Deterministic metadata generation for about/use/care/purchase fields.

## Local Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export VISION_BACKEND_TOKEN="$(openssl rand -hex 32)"
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Warmup:

```bash
curl -X POST -H "Authorization: Bearer $VISION_BACKEND_TOKEN" http://127.0.0.1:8010/warmup
```

## Environment

```text
CLASSIFIER_TOP_K=5
CLASSIFIER_VIEWS=3
ONNX_THREADS=1
ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
VISION_BACKEND_TOKEN=long-random-token
```

Set the same `VISION_BACKEND_TOKEN` in Vercel so only your app can call the backend. It must be at least 24 characters; the service reports unhealthy and rejects protected endpoints when it is absent or weak.

The default Render configuration is classifier-only so it can run on small instances. It uses the full image as the primary signal and adds a few lightweight supporting crops for stability. It is less precise than object detection, but avoids PyTorch/YOLO memory pressure.

For higher accuracy later, use a larger instance and reintroduce a detector service.
