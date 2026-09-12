import assert from "node:assert/strict";
import test from "node:test";
import { OperationRegistry } from "../operation-registry.js";

test("capture operation identity is independent in each Chrome tab", () => {
  const operations = new OperationRegistry();
  operations.start(11, "capture-a");
  operations.start(12, "capture-b");
  assert.equal(operations.isCurrent(11, "capture-a"), true);
  assert.equal(operations.isCurrent(11, "capture-b"), false);
  assert.equal(operations.isCurrent(12, "capture-b"), true);

  operations.start(11, "capture-new");
  operations.clear(11, "capture-a");
  assert.equal(operations.isCurrent(11, "capture-new"), true);
  operations.remove(11);
  assert.equal(operations.isCurrent(11, "capture-new"), false);
  assert.equal(operations.isCurrent(12, "capture-b"), true);
});
