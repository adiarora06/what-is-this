import assert from "node:assert/strict";
import test from "node:test";
import { WindowOperationRegistry } from "../window-operation-registry.js";

test("capture operation identity is independent in each Chrome window", () => {
  const operations = new WindowOperationRegistry();
  operations.start(11, "capture-a");
  operations.start(12, "capture-b");
  assert.equal(operations.isCurrent(11, "capture-a"), true);
  assert.equal(operations.isCurrent(11, "capture-b"), false);
  assert.equal(operations.isCurrent(12, "capture-b"), true);

  operations.start(11, "capture-new");
  operations.clear(11, "capture-a");
  assert.equal(operations.isCurrent(11, "capture-new"), true);
  operations.removeWindow(11);
  assert.equal(operations.isCurrent(11, "capture-new"), false);
  assert.equal(operations.isCurrent(12, "capture-b"), true);
});
