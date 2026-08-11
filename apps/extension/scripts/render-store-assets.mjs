#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(scriptDirectory, "..");
const assetDirectory = join(extensionDirectory, "store-assets");
const sessionKey = "whatIsThisGuideSessionV1:window:1";
let captureDataUrl = "";

const resultBase = {
  subject: "A snake plant care page",
  intent: "guide",
  goal: "Keep this plant healthy indoors",
  summary: "This page shows a snake plant and practical care information. The safest next step is to confirm the soil is dry before watering.",
  confidence: 0.88,
  evidence: [
    { claim: "Tall, upright leaves with mottled bands are visible.", visibleSource: "Plant photo in the capture" },
    { claim: "The page recommends bright, indirect light.", visibleSource: "Care summary beside the photo" },
  ],
  recommendedAction: {
    title: "Check the soil before watering",
    reason: "Snake plants tolerate dry soil better than repeated overwatering.",
  },
  steps: [
    {
      id: "check-soil",
      title: "Check soil moisture",
      instruction: "Press a finger into the top two inches of soil and water only when it feels dry.",
      completionCheck: "The soil is dry before water is added.",
      risk: "Stop if the pot is already wet or standing in water.",
    },
    {
      id: "place-plant",
      title: "Choose a bright position",
      instruction: "Place the plant near bright, indirect light and away from a hot vent.",
      completionCheck: "Leaves receive daylight without harsh midday sun.",
    },
  ],
  alternatives: [
    { title: "Lower-light placement", tradeoff: "The plant can adapt, but growth may be slower." },
  ],
  warnings: ["Keep the pot draining freely; standing water can damage the roots."],
  completionChecks: ["Soil is dry before watering.", "The pot drains freely.", "Leaves receive indirect daylight."],
  sources: [],
  processing: { provider: "local", model: "chrome-language-model" },
};

function sessionFor(state) {
  const base = {
    version: 1,
    status: "idle",
    draft: null,
    intent: "identify",
    goal: "",
    clarificationAnswer: "",
    clarificationError: null,
    result: null,
    responseWarnings: [],
    requestId: null,
    captureId: null,
    generationId: null,
    captureError: null,
    error: null,
    updatedAt: "2026-08-11T12:00:00.000Z",
  };
  if (state === "capture") return base;

  const clarification = state === "clarification";
  return {
    ...base,
    status: "complete",
    intent: clarification ? "explain" : "guide",
    goal: clarification ? "Understand the exact care needs" : "Keep this plant healthy indoors",
    draft: {
      id: `store-${state}`,
      createdAt: "2026-08-11T12:00:00.000Z",
      source: { kind: "visible-tab" },
      image: {
        dataUrl: captureDataUrl,
        originalDataUrl: null,
        mimeType: "image/jpeg",
        width: 860,
        height: 744,
      },
    },
    result: clarification ? {
      ...resultBase,
      intent: "explain",
      goal: "Understand the exact care needs",
      summary: "The capture appears to show a snake plant, but one label is needed before giving variety-specific guidance.",
      confidence: 0.3,
      steps: [],
      completionChecks: [],
      clarificationQuestion: "What exact variety or label is shown on the plant tag?",
    } : resultBase,
    requestId: `store-${state}`,
  };
}

function mockChromeScript(state) {
  return `<script>
    (() => {
      const stored = ${JSON.stringify({ [sessionKey]: null })};
      stored[${JSON.stringify(sessionKey)}] = ${JSON.stringify(sessionFor(state))};
      const storageListeners = [];
      globalThis.LanguageModel = {
        availability: async () => "available",
        create: async () => { throw new Error("Store artwork is read-only."); },
      };
      globalThis.chrome = {
        runtime: {
          id: "store-artwork",
          onMessage: { addListener() {} },
          sendMessage: async () => ({ ok: false, error: "Store artwork is read-only." }),
        },
        windows: { getCurrent: async () => ({ id: 1 }) },
        storage: {
          session: {
            get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in stored).map((key) => [key, stored[key]])),
            set: async (values) => Object.assign(stored, values),
            remove: async (keys) => { for (const key of (Array.isArray(keys) ? keys : [keys])) delete stored[key]; },
          },
          onChanged: { addListener(listener) { storageListeners.push(listener); } },
        },
      };
    })();
  </script>`;
}

function examplePage() {
  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#f8f7ef;color:#171914;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
    main{min-height:744px;padding:70px 74px;background:radial-gradient(circle at 85% 5%,#deeee9 0,transparent 280px)}
    .eyebrow{color:#176c5f;font-size:12px;font-weight:850;letter-spacing:.13em;text-transform:uppercase}
    h1{font-size:56px;letter-spacing:-.055em;line-height:.96;margin:12px 0 20px;max-width:610px}
    .lead{color:#666b60;font-size:18px;line-height:1.55;max-width:610px}
    .care{display:grid;grid-template-columns:330px 1fr;gap:32px;margin-top:42px;align-items:center}
    .plant{height:310px;border-radius:24px;background:#deeee9;position:relative;overflow:hidden;box-shadow:0 18px 45px #1b1f1a18}
    .pot{position:absolute;bottom:32px;left:95px;width:140px;height:105px;background:#efe6d8;border-radius:16px 16px 50px 50px;border-bottom:10px solid #bf8c54}
    .leaf{position:absolute;bottom:120px;left:150px;width:34px;height:150px;background:#176c5f;border-radius:90% 10% 90% 10%;transform-origin:bottom}
    .leaf:nth-child(2){transform:rotate(-27deg);height:125px}.leaf:nth-child(3){transform:rotate(28deg);height:132px}.leaf:nth-child(4){transform:rotate(-12deg);height:175px}.leaf:nth-child(5){transform:rotate(13deg);height:165px}
    .facts{display:grid;gap:12px}.fact{background:white;border:1px solid #dcddd3;border-radius:14px;padding:16px 18px;box-shadow:0 10px 28px #1b1f1a0d}.fact strong{display:block;font-size:15px}.fact span{color:#666b60;display:block;font-size:13px;line-height:1.45;margin-top:5px}
  </style></head><body><main>
    <p class="eyebrow">Everyday plant care</p><h1>Help your snake plant thrive indoors.</h1>
    <p class="lead">A resilient houseplant still benefits from the right light, careful watering, and a pot that drains freely.</p>
    <section class="care"><div class="plant" aria-label="Illustration of a snake plant"><i class="leaf"></i><i class="leaf"></i><i class="leaf"></i><i class="leaf"></i><i class="leaf"></i><div class="pot"></div></div>
    <div class="facts"><div class="fact"><strong>Light</strong><span>Bright, indirect daylight is ideal.</span></div><div class="fact"><strong>Water</strong><span>Let the top two inches of soil dry first.</span></div><div class="fact"><strong>Drainage</strong><span>Never leave the pot standing in water.</span></div></div></section>
  </main></body></html>`;
}

function showcasePage(state) {
  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
    .browser{height:100%;display:grid;grid-template-rows:56px 1fr;background:#ebece6}
    .toolbar{align-items:center;background:#fff;border-bottom:1px solid #d8dad1;display:grid;grid-template-columns:110px 1fr 190px;gap:16px;padding:0 20px}
    .dots{display:flex;gap:8px}.dots i{background:#d9dbd2;border-radius:50%;height:11px;width:11px}.address{background:#f2f3ee;border-radius:999px;color:#666b60;font-size:12px;padding:10px 18px}.extension-name{color:#176c5f;font-size:12px;font-weight:800;text-align:right}
    .content{display:grid;grid-template-columns:minmax(0,1fr) 430px;min-height:0}.page{border:0;height:100%;width:100%}.panel{background:#f5f5ef;border:0;border-left:1px solid #d8dad1;height:100%;width:100%}
  </style></head><body><div class="browser"><header class="toolbar"><span class="dots"><i></i><i></i><i></i></span><div class="address">example.local/plant-care</div><div class="extension-name">What Is This? Guide</div></header><div class="content"><iframe class="page" title="Example plant care page" src="/example.html"></iframe><iframe class="panel" title="What Is This? Guide side panel" src="/sidepanel.html?state=${state}"></iframe></div></div></body></html>`;
}

const mimeTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".png": "image/png" };

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/example.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(examplePage());
      return;
    }
    if (url.pathname === "/showcase.html") {
      const state = ["capture", "guide", "clarification"].includes(url.searchParams.get("state")) ? url.searchParams.get("state") : "capture";
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(showcasePage(state));
      return;
    }

    const relativePath = url.pathname.replace(/^\/+/, "") || "sidepanel.html";
    const allowed = new Set(["sidepanel.html", "sidepanel.css", "sidepanel.js", "session-store.js", "guide-adapter.js", "extension-policy.js"]);
    if (!allowed.has(relativePath)) {
      response.writeHead(404).end("Not found");
      return;
    }
    let body = await readFile(join(extensionDirectory, relativePath));
    if (relativePath === "sidepanel.html") {
      const state = ["capture", "guide", "clarification"].includes(url.searchParams.get("state")) ? url.searchParams.get("state") : "capture";
      body = Buffer.from(body.toString("utf8").replace('<script type="module" src="sidepanel.js"></script>', `${mockChromeScript(state)}\n    <script type="module" src="sidepanel.js"></script>`));
    }
    response.writeHead(200, { "Content-Type": `${mimeTypes[extname(relativePath)] || "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(body);
  } catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : "Server error");
  }
});

await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not start the local Store artwork renderer.");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const captureContext = await browser.newContext({ viewport: { width: 860, height: 744 }, deviceScaleFactor: 1 });
  const capturePage = await captureContext.newPage();
  await capturePage.goto(`${origin}/example.html`, { waitUntil: "networkidle" });
  const captureBytes = await capturePage.screenshot({ type: "jpeg", quality: 82 });
  captureDataUrl = `data:image/jpeg;base64,${captureBytes.toString("base64")}`;
  await captureContext.close();

  const outputs = [
    ["capture", "screenshot-01-capture-1280x800.png"],
    ["guide", "screenshot-02-guide-1280x800.png"],
    ["clarification", "screenshot-03-clarification-1280x800.png"],
  ];

  for (const [state, filename] of outputs) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${origin}/showcase.html?state=${state}`, { waitUntil: "networkidle" });
    const panelFrame = page.frames().find((frame) => frame.url().includes("/sidepanel.html"));
    if (!panelFrame) throw new Error(`The ${state} side panel did not load.`);
    await panelFrame.locator("#browser-ai-status").filter({ hasText: "Ready" }).waitFor();
    if (state !== "capture") {
      await panelFrame.locator("#result-panel").waitFor({ state: "visible" });
      await panelFrame.locator("#result-panel").evaluate((element) => element.scrollIntoView({ block: "start" }));
    }
    await page.screenshot({ path: join(assetDirectory, filename), type: "png" });
    await context.close();
  }

  console.log(`Rendered ${outputs.length} Store screenshots in ${assetDirectory}.`);
} finally {
  await browser.close();
  server.close();
}
