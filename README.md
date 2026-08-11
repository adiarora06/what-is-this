# What Is This?

A private-first visual identifier and contextual guide for phones, desktops, and Chrome.

The app captures or uploads one image, identifies the main object, asks the person to confirm or correct the result, and saves verified objects into searchable boards. It can run entirely on-device for free, or use an optional cloud provider for broader recognition.

## Architecture

- **Next.js on Vercel**: focused scan, result, saved-library, and settings views plus a hardened `/api/identify` proxy.
- **Contextual guide API**: a shared, validated `/api/guide` contract for identify, explain, troubleshoot, compare, and step-by-step guide requests.
- **Chrome side-panel companion**: a publication-ready Manifest V3 extension in `apps/extension` that captures the visible tab only after a disclosed user action, supports manual cropping, and uses supported Chrome on-device AI to clarify an answer without another capture or cloud upload.
- **Private on-device vision**: integrity-checked MobileNetV2 classification, barcode detection, and optional OCR loaded only when needed. ONNX Runtime's pinned WASM files are copied from the installed package and served from the app origin.
- **Gemini vision provider**: high-accuracy image understanding when `GEMINI_API_KEY` is set.
- **Python classifier service**: lightweight ONNX MobileNetV2 backend for Render's low-memory free/small instances.
- **Supabase (optional)**: passwordless email accounts, private image storage, conflict-safe cloud/device board merging, and labeled accuracy feedback.
- **Durable local data**: versioned IndexedDB storage with schema validation, legacy migration, and safe fallbacks.
- **PWA**: installable phone app shell; on-device identification works after the verified model has downloaded once.
- **OpenAI**: optional legacy fallback only when `ALLOW_OPENAI_FALLBACK=true`.

The browser defaults to **On this device**, which keeps images in the browser and requires no paid service. **Best available** appears only when a working cloud provider and its security configuration are detected; it falls back to private recognition if the network or backend later becomes unavailable.

The server's default `ACCURACY_PROVIDER=auto` behavior is Gemini first when a key exists, then the classifier backend, then OpenAI only if explicitly enabled.

The Vision engine selector is strict: choosing Gemini returns a visible Gemini error instead of silently using the classifier. **Best available** is the only mode that falls back between providers.

The production API validates JPEG/PNG/WebP payloads, caps decoded images at 3 MB, applies a best-effort per-instance rate limit, times out external providers, and emits request/provider events to Vercel logs. The classifier runs as a non-root container and requires a strong shared bearer token; optional Cloudflare Turnstile verification protects remote inference quota. Phone uploads are resized before scanning and saved images are stored as smaller thumbnails.

## Try The Chrome Extension

The extension is intentionally separate from the deployed website while sharing its guide response shape. It requires Chrome 148+ on a supported desktop device because screenshot guidance uses the multimodal Prompt API, and it uses Chrome's built-in AI entirely on-device with no mock or cloud fallback. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension`; see [`apps/extension/README.md`](apps/extension/README.md) for privacy boundaries, verification, and Store packaging.

The public privacy policy is available at [`/privacy`](https://what-is-this-mobile.vercel.app/privacy), and copy-ready Chrome Web Store fields are maintained in [`apps/extension/STORE_LISTING.md`](apps/extension/STORE_LISTING.md).

## Run Locally

The app works without a backend when **On this device** is selected in Settings. To test the optional Python fallback, generate a strong token and use the same value for both services:

```bash
openssl rand -hex 32
```

Set that value as `VISION_BACKEND_TOKEN` in the model-service environment and in `.env.local`, then start the lightweight classifier backend:

```bash
cd model-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export VISION_BACKEND_TOKEN="replace-with-your-generated-token"
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Warm the classifier:

```bash
curl -X POST -H "Authorization: Bearer $VISION_BACKEND_TOKEN" http://127.0.0.1:8010/warmup
```

Start the phone app:

```bash
cd ..
npm install
cp .env.example .env.local
npm run dev
```

The application opens at `http://127.0.0.1:3000`. Startup prints the listener details and stops with an actionable diagnostic if port 3000 is already occupied.

For accurate local testing, set a Gemini key in `.env.local`. Keep the classifier URL as fallback:

```text
ACCURACY_PROVIDER=auto
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.5-flash
VISION_BACKEND_URL=http://127.0.0.1:8010
VISION_BACKEND_TOKEN=the-same-generated-token
ALLOW_OPENAI_FALLBACK=false
GUIDE_PROVIDER=auto
GUIDE_OPENAI_MODEL=gpt-5.6-luna
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
npx vercel@latest env add REQUIRE_TURNSTILE
npx vercel@latest env add NEXT_PUBLIC_TURNSTILE_SITE_KEY
npx vercel@latest env add TURNSTILE_SECRET_KEY
npx vercel@latest env add NEXT_PUBLIC_SUPABASE_URL
npx vercel@latest env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npx vercel@latest --prod
```

Use:

```text
ACCURACY_PROVIDER=auto
GEMINI_MODEL=gemini-2.5-flash
VISION_BACKEND_URL=https://what-is-this-1.onrender.com
REQUIRE_TURNSTILE=true
```

In Render, set `VISION_BACKEND_TOKEN` to the same generated value used by Vercel. The backend intentionally returns `503` for `/identify` and `/warmup` if this token is missing or shorter than 24 characters.

For free global abuse protection, create a Cloudflare Turnstile widget for the production hostname and set both its public site key and secret in Vercel. Keep `REQUIRE_TURNSTILE=true` in production. Local development can leave all three Turnstile variables empty and `REQUIRE_TURNSTILE=false`.

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

The migration creates owner-scoped tables with row-level security and a private `scan-images` bucket. When an account connects, cloud and device boards are merged by stable IDs instead of replacing local-only data. Never add a Supabase secret or service-role key to a `NEXT_PUBLIC_` variable.

## Where Hugging Face Fits

Hugging Face is a hub for open-source AI models, datasets, and hosted inference. In this project it can be used in three ways:

- **Find models**: compare open vision-language models such as Qwen-VL, Florence, SmolVLM, or CLIP-based classifiers.
- **Hosted inference**: call a Hugging Face Inference Provider from `/api/identify` instead of Gemini.
- **Host your own backend**: deploy a Hugging Face Space that runs a larger model than Render's 512 MB instance can handle.

For easiest accuracy today, Gemini is the cleanest path because it can identify arbitrary objects from an image without running a huge model on Render. Hugging Face is the best next path when you want open models or your own hosted model service.

## Learning Catalog

If a result is wrong or too generic, correct its name and category in the app. Corrections use stricter combined image/label evidence, explain when learning changed a result, can be ignored from the result screen, and can be edited or forgotten in Settings.

## Backups And Restore

Settings can export a versioned JSON backup and restore it later. Imports are size-limited and schema-validated, show a count preview before replacement, and never sync automatically until the restored data has been reviewed.

## Accuracy Set

Use **Yes, correct** or **Correct it** after each scan. The app records the outcome locally, but stores a feedback image only after the person explicitly enables that setting. With Supabase enabled, consented images and labels are stored privately in the `scan_feedback` table and `scan-images` bucket for later evaluation or model training.

## Verification

```bash
npm test
npm run test:extension
npm run typecheck
npm run build
node_modules/.bin/playwright install chromium
E2E_PRODUCTION=1 npm run test:e2e
cd model-service && .venv/bin/python -m unittest discover -s tests -v
```

The production browser suite exercises small phones, compact phones, landscape, desktop, touch target sizing, navigation overlap, accessibility, and a real on-device identification under the production CSP. MobileNetV2 recognizes ImageNet classes rather than arbitrary products, so exact models, species, and safety-critical results still require independent confirmation.
