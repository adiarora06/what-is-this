import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verifyTurnstile", () => {
  it("stays optional when no Turnstile environment is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("REQUIRE_TURNSTILE", "false");
    await expect(verifyTurnstile(undefined, "unknown", "request-1")).resolves.toEqual({ ok: true });
  });

  it("fails closed when verification is required but the secret is missing", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("REQUIRE_TURNSTILE", "true");
    await expect(verifyTurnstile(undefined, "unknown", "request-2")).resolves.toMatchObject({ ok: false, status: 503 });
  });

  it("requires a client token when the secret is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    await expect(verifyTurnstile(undefined, "127.0.0.1", "request-3")).resolves.toEqual({
      ok: false,
      status: 403,
      error: "Complete the security check before continuing.",
    });
  });

  it("accepts a successful identify-action verification", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, action: "identify" }) }));
    await expect(verifyTurnstile("client-token", "127.0.0.1", "request-4")).resolves.toEqual({ ok: true });
  });

  it("can verify a route-specific action without changing the identify default", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, action: "guide" }) }));

    await expect(verifyTurnstile("client-token", "127.0.0.1", "request-5", "guide")).resolves.toEqual({ ok: true });
    await expect(verifyTurnstile("client-token", "127.0.0.1", "request-6")).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a success response that omits the bound action", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));

    await expect(verifyTurnstile("client-token", "127.0.0.1", "request-7", "guide")).resolves.toEqual({
      ok: false,
      status: 403,
      error: "Security verification expired. Try again.",
    });
  });
});
