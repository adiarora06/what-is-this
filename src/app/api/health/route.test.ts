import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps infrastructure configuration details out of the public response", async () => {
    vi.stubEnv("ACCURACY_PROVIDER", "classifier");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("VISION_BACKEND_URL", "https://classifier.example");
    vi.stubEnv("VISION_BACKEND_TOKEN", "too-short");
    vi.stubEnv("REQUIRE_TURNSTILE", "false");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ALLOW_OPENAI_FALLBACK", "false");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      ok: false,
      status: "private-ready",
      availableGuideProviders: [],
      error: "Cloud recognition is unavailable. On-device mode remains available.",
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|authentication|24 characters|backendError/i);
    expect(payload).not.toHaveProperty("turnstileRequired");
    expect(payload).not.toHaveProperty("turnstileConfigured");
  });

  it("authenticates Gemini health checks with a header instead of the URL", async () => {
    const apiKey = "health-key-that-must-not-appear-in-a-url";
    vi.stubEnv("GEMINI_API_KEY", apiKey);
    vi.stubEnv("GEMINI_MODEL", "gemini-test-header-auth");
    vi.stubEnv("VISION_BACKEND_URL", "");
    vi.stubEnv("REQUIRE_TURNSTILE", "false");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ALLOW_OPENAI_FALLBACK", "false");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      status: "cloud-ready",
      availableProviders: ["auto", "gemini"],
      availableGuideProviders: ["gemini"],
    });
    expect(JSON.stringify(payload)).not.toMatch(/api.?key|model|backend|turnstile|token/i);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain(apiKey);
    expect(new Headers(options?.headers).get("x-goog-api-key")).toBe(apiKey);
  });

  it("reports guide capability separately from classifier-only recognition", async () => {
    vi.stubEnv("ACCURACY_PROVIDER", "classifier");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ALLOW_OPENAI_FALLBACK", "false");
    vi.stubEnv("VISION_BACKEND_URL", "https://classifier.example");
    vi.stubEnv("VISION_BACKEND_TOKEN", "a-secure-classifier-token-12345");
    vi.stubEnv("REQUIRE_TURNSTILE", "false");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      availableProviders: ["auto", "classifier"],
      availableGuideProviders: [],
    });
  });

  it("exposes an OpenAI fallback as auto recognition and guide capability", async () => {
    vi.stubEnv("ACCURACY_PROVIDER", "auto");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "configured-openai-key");
    vi.stubEnv("ALLOW_OPENAI_FALLBACK", "true");
    vi.stubEnv("VISION_BACKEND_URL", "");
    vi.stubEnv("REQUIRE_TURNSTILE", "false");

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      status: "cloud-ready",
      availableProviders: ["auto", "openai"],
      availableGuideProviders: ["openai"],
    });
  });
});
