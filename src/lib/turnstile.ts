export type TurnstileResult =
  | { ok: true }
  | { ok: false; status: 403 | 503; error: string };

export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string,
  requestId: string,
  expectedAction = "identify",
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const required = process.env.REQUIRE_TURNSTILE === "true" || Boolean(secret || siteKey);
  if (!required) return { ok: true };
  if (!secret || !siteKey) return { ok: false, status: 503, error: "Scan verification is not configured." };
  if (!token) return { ok: false, status: 403, error: "Complete the security check before continuing." };

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (remoteIp !== "unknown") form.set("remoteip", remoteIp);
  form.set("idempotency_key", requestId);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const result = (await response.json()) as { success?: boolean; action?: string };
    if (!response.ok || !result.success || result.action !== expectedAction) {
      return { ok: false, status: 403, error: "Security verification expired. Try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 503, error: "Security verification is temporarily unavailable." };
  }
}
