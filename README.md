# What Is This? Mobile

A phone-first object identifier for Vercel.

The app captures the clearest frame after a 2-5 second hold, identifies the main object, then returns an object card with name, confidence, about text, use cases, care tips, shopping links, and save/storyboard actions. It also records confirmed and corrected results as a reusable accuracy set.

## Architecture

- **Next.js on Vercel**: phone camera UI, image upload, storyboard, learning catalog, `/api/identify` proxy.
- **Gemini vision provider**: high-accuracy image understanding when `GEMINI_API_KEY` is set.
- **Python classifier service**: lightweight ONNX MobileNetV2 backend for Render's low-memory free/small instances.
- **Supabase (optional)**: email accounts, private image storage, cloud storyboards, and labeled accuracy feedback.
- **Local fallback**: storyboards and corrections still work in one browser before Supabase is configured.
- **PWA**: installable phone app shell with camera support; live identification still requires a network connection.
- **OpenAI**: optional legacy fallback only when `ALLOW_OPENAI_FALLBACK=true`.

Default provider behavior is `ACCURACY_PROVIDER=auto`: Gemini first when a key exists, then the classifier backend, then OpenAI only if explicitly enabled.

The Vision engine selector is strict: choosing Gemini returns a visible Gemini error instead of silently using the classifier. **Best available** is the only mode that falls back between providers.

The production API validates JPEG/PNG/WebP payloads, caps decoded images at 3 MB, applies a best-effort per-instance rate limit, times out external providers, and emits request/provider events to Vercel logs. Phone uploads are resized before scanning and local storyboard images are stored as smaller thumbnails.

## Run Locally

Start the lightweight classifier backend:

```bash
cd /Users/adiarora/Documents/Codex/2026-07-05/i-wa/outputs/what-is-this-mobile/model-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Warm the classifier:

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

For accurate local testing, set a Gemini key in `.env.local`. Keep the classifier URL as fallback:

```text
ACCURACY_PROVIDER=auto
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.5-flash
VISION_BACKEND_URL=http://127.0.0.1:8010
ALLOW_OPENAI_FALLBACK=false
```

## Deploy To Vercel

Deploy the Next app to Vercel. Host `model-service/` separately on Render, Railway, Fly.io, Modal, Hugging Face Spaces, Replicate, or a VPS.

Set Vercel env vars:

```bash
npx vercel@latest env add ACCURACY_PROVIDER
npx vercel@latest env add GEMINI_API_KEY
npx vercel@latest env add GEMINI_MODEL
npx vercel@latest env add VISION_BACKEND_URL
npx vercel@latest env add VISION_BACKEND_TOKEN
npx vercel@latest env add NEXT_PUBLIC_SUPABASE_URL
npx vercel@latest env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npx vercel@latest --prod
```

Use:

```text
ACCURACY_PROVIDER=auto
GEMINI_MODEL=gemini-2.5-flash
VISION_BACKEND_URL=https://what-is-this-1.onrender.com
```

Do not commit real API keys. Add them in the Vercel dashboard or with `npx vercel@latest env add`.

The repo includes `render.yaml` and `model-service/Dockerfile` for a Render Docker deployment.

## Enable Cloud Storyboards

Supabase is optional. Without these variables, the app stays in local-only mode.

1. Add Supabase to the Vercel project from the Vercel Marketplace, or create a free project at Supabase.
2. In Supabase, copy the Project URL and publishable key from the project's Connect dialog.
3. Add them to local `.env.local` and to Vercel:

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

4. Apply the checked-in schema. Link the Supabase CLI to the project, then push the migration:

```bash
npx supabase@2.109.1 login
npx supabase@2.109.1 link --project-ref YOUR_PROJECT_REF
npx supabase@2.109.1 db push --linked
```

5. In Supabase Auth URL Configuration, set the Site URL to the production Vercel URL and allow the local URL while developing.
6. Redeploy Vercel after adding the two public environment variables.

The migration creates owner-scoped tables with row-level security and a private `scan-images` bucket. Never add a Supabase secret or service-role key to a `NEXT_PUBLIC_` variable.

## Where Hugging Face Fits

Hugging Face is a hub for open-source AI models, datasets, and hosted inference. In this project it can be used in three ways:

- **Find models**: compare open vision-language models such as Qwen-VL, Florence, SmolVLM, or CLIP-based classifiers.
- **Hosted inference**: call a Hugging Face Inference Provider from `/api/identify` instead of Gemini.
- **Host your own backend**: deploy a Hugging Face Space that runs a larger model than Render's 512 MB instance can handle.

For easiest accuracy today, Gemini is the cleanest path because it can identify arbitrary objects from an image without running a huge model on Render. Hugging Face is the best next path when you want open models or your own hosted model service.

## Learning Catalog

If the backend is wrong or too generic, correct the object name/category in the app. Corrections are saved locally and reused when future backend labels match. Export `what-is-this-catalog.json` to seed a future custom training dataset or visual-search catalog.

## Accuracy Set

Use **Yes, correct** or **Not quite** after each scan. The app tracks accepted and corrected predictions, stores a compact image thumbnail when browser storage allows, and exports `what-is-this-accuracy-set.json`. With Supabase enabled, full scan images and labels are stored privately in the `scan_feedback` table and `scan-images` bucket for later evaluation or model training.

## Verification

```bash
npm test
npm run typecheck
npm run build
cd model-service && .venv/bin/python -m unittest discover -s tests -v
```

The MobileNetV2 fallback recognizes ImageNet classes rather than arbitrary products. It now treats living-creature classes as non-shopping results and uses cautious metadata, but Gemini or another vision-language model is still required for broad, specific object understanding.
