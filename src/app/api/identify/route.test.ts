import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purchaseLinksFor } from "@/lib/links";
import { MAX_REQUEST_BYTES } from "@/lib/vision-policy";
import { POST } from "./route";

const { openAIResponsesCreate } = vi.hoisted(() => ({ openAIResponsesCreate: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: openAIResponsesCreate };
  },
}));

const endpoint = "http://localhost/api/identify";
const image = "data:image/jpeg;base64,/9j/2Q==";
let clientAddress = 10;

function uniqueIp() {
  const address = `198.51.100.${clientAddress}`;
  clientAddress += 1;
  return address;
}

function request(body: unknown, headers: Record<string, string> = {}, ip = uniqueIp()) {
  return new Request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip, ...headers },
    body: JSON.stringify(body),
  });
}

function rawRequest(body: BodyInit, headers: Record<string, string> = {}, ip = uniqueIp()) {
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip, ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
  } satisfies RequestInit & { duplex?: "half" };
  return new Request(endpoint, init);
}

function providerCard(overrides: Record<string, unknown> = {}) {
  return {
    objectName: "USB-C hub",
    shortName: "USB-C hub",
    confidence: 0.92,
    category: "Electronics",
    about: "A compact adapter that adds ports to a USB-C device.",
    visualClues: ["Several ports are visible."],
    useCases: ["Connect common peripherals."],
    careTips: ["Keep the ports dry and clear of debris."],
    purchaseQuery: "USB-C hub",
    purchaseLinks: [],
    shoppingRecommended: true,
    safetyNote: null,
    alternatives: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("ACCURACY_PROVIDER", "auto");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GEMINI_MODEL", "gemini-test-model");
  vi.stubEnv("VISION_BACKEND_URL", "");
  vi.stubEnv("VISION_BACKEND_TOKEN", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ALLOW_OPENAI_FALLBACK", "false");
  vi.stubEnv("REQUIRE_TURNSTILE", "false");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  openAIResponsesCreate.mockReset();
});

describe("POST /api/identify", () => {
  it("returns a structured 400 for malformed JSON with request and rate-limit metadata", async () => {
    const response = await POST(rawRequest('{"image":'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ ok: false, error: "Request body must be valid JSON." });
    expect(payload.requestId).toBeTruthy();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(payload.requestId);
    expect(response.headers.get("x-ratelimit-limit")).toBe("20");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("19");
  });

  it("rejects a streamed body over the byte limit without trusting Content-Length", async () => {
    let pullCount = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array(pullCount === 1 ? MAX_REQUEST_BYTES : 1));
      },
      cancel,
    });

    const response = await POST(rawRequest(body));
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload).toMatchObject({ ok: false, error: "Image request is too large." });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.headers.get("x-ratelimit-remaining")).toBe("19");
  });

  it("keeps an explicitly requested provider strict when it fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("VISION_BACKEND_URL", "https://classifier.example");
    vi.stubEnv("VISION_BACKEND_TOKEN", "classifier-token-at-least-24-characters");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    vi.stubEnv("ALLOW_OPENAI_FALLBACK", "true");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: { message: "sensitive upstream diagnostic" } }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ image, provider: "gemini" }));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toMatchObject({ ok: false, error: "Gemini vision is unavailable." });
    expect(JSON.stringify(payload)).not.toContain("sensitive upstream diagnostic");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
    expect(openAIResponsesCreate).not.toHaveBeenCalled();
    expect(response.headers.get("x-vision-provider")).toBeNull();
  });

  it("authenticates Gemini through a header without putting credentials in the request URL or logs", async () => {
    const apiKey = "identify-key-that-must-never-appear-in-a-url";
    vi.stubEnv("GEMINI_API_KEY", apiKey);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(providerCard()) }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ image, provider: "gemini" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, provider: "gemini", model: "gemini-test-model" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [providerUrl, providerOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(providerUrl).search).toBe("");
    expect(providerUrl).not.toContain(apiKey);
    expect(new Headers(providerOptions.headers).get("x-goog-api-key")).toBe(apiKey);
    expect(JSON.stringify(info.mock.calls)).not.toContain(apiKey);
  });

  it("uses the automatic provider order and returns earlier failures as warnings", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("VISION_BACKEND_URL", "https://classifier.example/");
    vi.stubEnv("VISION_BACKEND_TOKEN", "classifier-token-at-least-24-characters");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "temporary provider failure" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ model: "classifier-v2", card: providerCard({ shoppingRecommended: false }) }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ image, provider: "auto" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      provider: "classifier",
      model: "classifier-v2",
      warnings: ["Gemini vision is unavailable."],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://classifier.example/identify");
    expect(response.headers.get("x-vision-provider")).toBe("classifier");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("19");
  });

  it("replaces provider-controlled purchase links with the curated store list", async () => {
    const purchaseQuery = "ceramic mug & lid";
    vi.stubEnv("VISION_BACKEND_URL", "https://classifier.example");
    vi.stubEnv("VISION_BACKEND_TOKEN", "classifier-token-at-least-24-characters");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        model: "classifier-v2",
        card: providerCard({
          category: "Kitchen",
          purchaseQuery,
          purchaseLinks: [{ label: "Provider store", url: "https://attacker.example/buy" }],
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ image, provider: "classifier" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.card.purchaseLinks).toEqual(purchaseLinksFor(purchaseQuery));
    expect(JSON.stringify(payload.card.purchaseLinks)).not.toContain("attacker.example");
  });

  it("completes Turnstile verification before calling a vision provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "turnstile-test-secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "turnstile-test-site-key");
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ success: false, action: "identify" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ image, provider: "gemini", turnstileToken: "client-token" }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({ ok: false, error: "Security verification expired. Try again." });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect((options.body as FormData).get("response")).toBe("client-token");
  });

  it("rate limits one client while preserving a fresh bucket for a unique IP", async () => {
    const limitedIp = "203.0.113.200";
    for (let index = 0; index < 20; index += 1) {
      const response = await POST(rawRequest("{", {}, limitedIp));
      expect(response.status).toBe(400);
      expect(response.headers.get("x-ratelimit-limit")).toBe("20");
      expect(response.headers.get("x-ratelimit-remaining")).toBe(String(19 - index));
    }

    const limited = await POST(rawRequest("{", {}, limitedIp));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    const fresh = await POST(rawRequest("{", {}, "203.0.113.201"));
    expect(fresh.status).toBe(400);
    expect(fresh.headers.get("x-ratelimit-remaining")).toBe("19");
  });
});
