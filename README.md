# What Is This? Mobile

A phone-first object identifier for Vercel with a real computer-vision backend.

The phone app captures the clearest frame after a 2-5 second hold, sends it to your own CV backend, then returns an object card with name, confidence, about text, use cases, care tips, purchase links, and saved/storyboard actions.

## Architecture

- **Next.js on Vercel**: phone camera UI, storyboard, learning catalog, `/api/identify` proxy.
- **Python model service**: YOLO detection, primary-object crop, ConvNeXt classification, deterministic result cards.
- **OpenAI**: optional fallback only when `ALLOW_OPENAI_FALLBACK=true`.

## Run Locally

Start the CV backend:

```bash
cd /Users/adiarora/Documents/Codex/2026-07-05/i-wa/outputs/what-is-this-mobile/model-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
```

Warm the models:

```bash
curl -X POST http://127.0.0.1:8010/warmup
```

Start the phone app:

```bash
cd /Users/adiarora/Documents/Codex/2026-07-05/i-wa/outputs/what-is-this-mobile
npm install
cp .env.example .env.local
npm run dev
```

For local testing, keep the backend URL in `.env.local`:

```text
VISION_BACKEND_URL=http://127.0.0.1:8010
ALLOW_OPENAI_FALLBACK=false
```

## Deploy

Deploy the Next app to Vercel. Host `model-service/` separately on Render, Railway, Fly.io, Modal, Hugging Face Spaces, Replicate, or a VPS. Set these Vercel env vars:

```bash
npx vercel@latest env add VISION_BACKEND_URL
npx vercel@latest env add VISION_BACKEND_TOKEN
npx vercel@latest --prod
```

The repo includes `render.yaml` and `model-service/Dockerfile` for a Render Docker deployment.

## Learning Catalog

If the backend is wrong or too generic, correct the object name/category in the app. Corrections are saved locally and reused when future backend labels match. Export `what-is-this-catalog.json` to seed a future custom training dataset or visual-search catalog.
