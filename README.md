# What Is This? Mobile

A phone-first object identifier for Vercel.

Point a phone camera at one object, hold it still for 2-5 seconds, and the app captures the clearest frame. It then asks a vision model to identify the object and returns:

- Object name and confidence.
- An “About Me” card written from the object’s point of view.
- Visual clues.
- Common use cases.
- Care tips.
- Shopping/search links.
- Save-later storyboard stored in the browser.

## Run Locally

```bash
cd /Users/adiarora/Documents/Codex/2026-07-05/i-wa/outputs/what-is-this-mobile
npm install
cp .env.example .env.local
# Add OPENAI_API_KEY to .env.local
npm run dev
```

Open `http://localhost:3000` on your phone over the same network, or use a tunneling service. Camera access requires HTTPS on most phones, except for localhost.

## Deploy To Vercel

```bash
npx vercel@latest login
npx vercel@latest
npx vercel@latest env add OPENAI_API_KEY
npx vercel@latest env add OPENAI_MODEL
npx vercel@latest --prod
```

Recommended default:

```text
OPENAI_MODEL=gpt-5.6-luna
```

Use a stronger model if you need better brand/model recognition. Keep the API key server-side only; do not expose it in `NEXT_PUBLIC_*` variables.

## Product Notes

- The client samples frames during the hold window and chooses the sharpest frame using an edge/brightness score.
- The model sees one image, not a live video stream. That keeps latency and cost much lower.
- Purchase buttons are search links, not affiliate links or guaranteed product matches.
- Storyboard saves locally in the browser. For account sync, add a database later.
