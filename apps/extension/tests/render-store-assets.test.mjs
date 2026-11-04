import assert from "node:assert/strict";
import test from "node:test";
import { createStoreAssetServer, showcasePage } from "../scripts/render-store-assets.mjs";

async function listen(server) {
  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start.");
  return `http://127.0.0.1:${address.port}`;
}

test("showcase markup selects only fixed side-panel paths", () => {
  const payload = 'guide\"><script>globalThis.injected=true</script>';
  const page = showcasePage(payload);

  assert.match(page, /src="\/sidepanel-capture\.html"/);
  assert.doesNotMatch(page, /globalThis\.injected|<script>/);
});

test("renderer never reflects request query values into HTML", async (context) => {
  const server = createStoreAssetServer();
  context.after(() => new Promise((resolveClosed) => server.close(resolveClosed)));
  const origin = await listen(server);
  const payload = '\"><img src=x onerror=globalThis.injected=true>';

  const response = await fetch(
    `${origin}/showcase-guide.html?state=${encodeURIComponent(payload)}`,
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /src="\/sidepanel-guide\.html"/);
  assert.doesNotMatch(body, /onerror|globalThis\.injected/);

  const missing = await fetch(
    `${origin}/showcase.html?state=${encodeURIComponent(payload)}`,
  );
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /onerror|globalThis\.injected/);
});
