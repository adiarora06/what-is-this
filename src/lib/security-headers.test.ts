import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/lib/security-headers";

describe("content security policy", () => {
  it("allows WebAssembly compilation without broad production unsafe-eval", () => {
    const policy = buildContentSecurityPolicy(false, true);
    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).not.toMatch(/script-src[^;]*\s'unsafe-eval'/);
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("keeps the development evaluator needed by the framework", () => {
    const policy = buildContentSecurityPolicy(true, false);
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
