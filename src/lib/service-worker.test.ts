import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type RequestLike = {
  headers: { has: (name: string) => boolean };
  method: string;
  mode: string;
  url: string;
};

type ResponseLike = {
  id: string;
  ok: boolean;
  type: string;
  clone: () => ResponseLike;
};

function response(id: string): ResponseLike {
  return {
    id,
    ok: true,
    type: "basic",
    clone: () => response(`${id}-cached`),
  };
}

function request(path: string): RequestLike {
  return {
    headers: { has: () => false },
    method: "GET",
    mode: "navigate",
    url: `https://example.test${path}`,
  };
}

describe("offline navigation cache", () => {
  it("caches each page under its request without replacing the homepage fallback", async () => {
    const source = await readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const cached = new Map<string, ResponseLike>([["https://example.test/", response("homepage-shell")]]);
    for (let index = 0; index < 40; index += 1) {
      cached.set(`https://example.test/_next/static/asset-${index}.js`, response(`asset-${index}`));
    }
    let fetchResult: ResponseLike | Error = response("privacy-network");
    let cacheWriteFails = false;
    const keyFor = (value: string | RequestLike) =>
      typeof value === "string" ? new URL(value, "https://example.test").href : value.url;
    const cache = {
      addAll: async () => undefined,
      delete: async (value: string | RequestLike) => cached.delete(keyFor(value)),
      keys: async () => [...cached.keys()].map((url) => ({ url })),
      put: async (value: string | RequestLike, valueResponse: ResponseLike) => {
        if (cacheWriteFails) throw new Error("cache quota exceeded");
        cached.set(keyFor(value), valueResponse);
      },
    };
    const caches = {
      delete: async () => true,
      keys: async () => ["what-is-this-shell-v4"],
      match: async (value: string | RequestLike) => cached.get(keyFor(value)),
      open: async () => cache,
    };
    const self = {
      addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, listener),
      clients: { claim: async () => undefined },
      location: { origin: "https://example.test" },
      skipWaiting: () => undefined,
    };
    const fetch = async () => {
      if (fetchResult instanceof Error) throw fetchResult;
      return fetchResult;
    };

    runInNewContext(source, { URL, caches, fetch, self });
    const fetchListener = listeners.get("fetch");
    expect(fetchListener).toBeDefined();

    const navigate = async (navigationRequest: RequestLike) => {
      let pending: Promise<ResponseLike | undefined> | undefined;
      fetchListener?.({
        request: navigationRequest,
        respondWith: (result: Promise<ResponseLike | undefined>) => {
          pending = result;
        },
      });
      expect(pending).toBeDefined();
      return pending;
    };

    expect((await navigate(request("/privacy")))?.id).toBe("privacy-network");
    expect(cached.size).toBe(40);
    expect(cached.get("https://example.test/")?.id).toBe("homepage-shell");
    expect(cached.get("https://example.test/privacy")?.id).toBe("privacy-network-cached");

    cacheWriteFails = true;
    fetchResult = response("settings-network");
    expect((await navigate(request("/settings")))?.id).toBe("settings-network");

    cacheWriteFails = false;
    fetchResult = new Error("offline");
    expect((await navigate(request("/privacy")))?.id).toBe("privacy-network-cached");
    expect((await navigate(request("/not-cached")))?.id).toBe("homepage-shell");
  });
});
