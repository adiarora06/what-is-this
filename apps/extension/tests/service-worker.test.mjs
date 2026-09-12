import assert from "node:assert/strict";
import test from "node:test";
import { sessionKeyForTab } from "../session-store.js";

function chromeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); },
    emit(...args) { return listeners.map((listener) => listener(...args)); },
  };
}

test("the worker keeps captures separated by active tab and clears closed tabs", async (context) => {
  const previousChrome = globalThis.chrome;
  const records = {};
  const openedPanels = [];
  const actionClicked = chromeEvent();
  const tabActivated = chromeEvent();
  const tabRemoved = chromeEvent();
  const tabUpdated = chromeEvent();
  const windowRemoved = chromeEvent();
  const runtimeMessages = chromeEvent();
  globalThis.chrome = {
    runtime: {
      id: "extension-test",
      onInstalled: chromeEvent(),
      onStartup: chromeEvent(),
      onMessage: runtimeMessages,
      async sendMessage() {},
    },
    action: { onClicked: actionClicked },
    sidePanel: {
      async setPanelBehavior() {},
      async open(options) { openedPanels.push(options); },
    },
    storage: {
      local: { async remove() {} },
      session: {
        async get(keys) {
          if (keys === null) return { ...records };
          const requested = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(requested.filter((key) => key in records).map((key) => [key, records[key]]));
        },
        async set(values) { Object.assign(records, values); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete records[key];
        },
      },
    },
    tabs: {
      onActivated: tabActivated,
      onRemoved: tabRemoved,
      onUpdated: tabUpdated,
      async captureVisibleTab() { return "data:image/jpeg;base64,AA=="; },
    },
    windows: { onRemoved: windowRemoved },
  };
  context.after(() => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });

  await import(`../service-worker.js?test=${Date.now()}`);
  const sendRuntimeMessage = (message) => new Promise((resolve) => {
    const handled = runtimeMessages.listeners[0](message, { id: "extension-test" }, resolve);
    assert.equal(handled, true);
  });

  actionClicked.emit({ id: 101, windowId: 7 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(openedPanels, [{ windowId: 7 }]);
  assert.equal((await sendRuntimeMessage({ type: "CAPTURE_ACTIVE_TAB", tabId: 101, windowId: 7 })).ok, true);
  assert.equal(records[sessionKeyForTab(101)].draft.image.dataUrl, "data:image/jpeg;base64,AA==");

  tabActivated.emit({ tabId: 202, windowId: 7 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const staleCapture = await sendRuntimeMessage({ type: "CAPTURE_ACTIVE_TAB", tabId: 101, windowId: 7 });
  assert.equal(staleCapture.ok, false);
  assert.match(staleCapture.error, /active tab changed/i);

  actionClicked.emit({ id: 202, windowId: 7 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await sendRuntimeMessage({ type: "CAPTURE_ACTIVE_TAB", tabId: 202, windowId: 7 })).ok, true);
  assert.notEqual(records[sessionKeyForTab(101)].draft.id, records[sessionKeyForTab(202)].draft.id);

  tabUpdated.emit(202, { status: "loading" }, { id: 202, windowId: 7 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const afterNavigation = await sendRuntimeMessage({ type: "CAPTURE_ACTIVE_TAB", tabId: 202, windowId: 7 });
  assert.equal(afterNavigation.ok, false);
  assert.match(afterNavigation.error, /toolbar icon/i);

  tabRemoved.emit(101);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sessionKeyForTab(101) in records, false);
  assert.equal(sessionKeyForTab(202) in records, true);
});
