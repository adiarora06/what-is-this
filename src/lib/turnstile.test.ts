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
    await expect(verifyTurnstile(undefined, "127.0.0.1", "request-3")).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("accepts a successful identify-action verification", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, action: "identify" }) }));
    await expect(verifyTurnstile("client-token", "127.0.0.1", "request-4")).resolves.toEqual({ ok: true });
  });
});
