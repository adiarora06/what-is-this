import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_GUIDE_RESPONSE_CONSTRAINT,
  GUIDE_RESULT_SCHEMA,
  GuideAdapterError,
  TRUSTED_BACKEND_ORIGIN,
  buildGuideRequest,
  createPreviewGuide,
  endpointForBackendOrigin,
  normalizeGuideResult,
  originPermissionForBackend,
  runBrowserGuide,
  runCloudGuide,
} from "../guide-adapter.js";

const image = "data:image/jpeg;base64,AA==";

function validResult(overrides = {}) {
  return {
    subject: "A captured control panel",
    intent: "identify",
    goal: "Identify the controls",
    summary: "The capture appears to show a control panel.",
    confidence: 0.72,
    evidence: [{ claim: "Several labeled controls are visible.", visibleSource: "Center of capture" }],
    recommendedAction: { title: "Read the labels", reason: "Visible labels are stronger evidence than shape alone." },
    steps: [{ id: "read-labels", title: "Read labels", instruction: "Zoom in and read each label." }],
    alternatives: [],
    warnings: [],
    completionChecks: ["Each control has a confirmed label."],
    sources: [],
    processing: { provider: "local", model: "test-model" },
    ...overrides,
  };
}

test("buildGuideRequest matches the shared flat request and bounds the title", () => {
  const request = buildGuideRequest({
    intent: "identify",
    image,
    title: "x".repeat(400),
    selection: " selected text ",
    url: "https://example.com/item",
  });
  assert.equal(request.title.length, 300);
  assert.equal(request.selection, "selected text");
  assert.equal(request.url, "https://example.com/item");
  assert.equal(request.image, image);
});

test("page URLs drop query secrets and reject embedded credentials", () => {
  const sanitized = buildGuideRequest({
    intent: "identify",
    image,
    url: "https://example.com/account/setup?token=secret#private",
  });
  assert.equal(sanitized.url, "https://example.com/account/setup");

  const rejected = buildGuideRequest({
    intent: "identify",
    image,
    url: "https://user:password@example.com/account",
  });
  assert.equal("url" in rejected, false);
});

test("page URLs are capped to the shared 2,048-character contract", () => {
  const request = buildGuideRequest({
    intent: "identify",
    image,
    url: `https://example.com/${"a".repeat(3_000)}`,
  });
  assert.equal(request.url.length, 2_048);
  assert.equal(GUIDE_RESULT_SCHEMA.properties.sources.items.properties.url.maxLength, 2_048);
});

test("goal is required for troubleshoot, compare, and guide", () => {
  for (const intent of ["troubleshoot", "compare", "guide"]) {
    assert.throws(
      () => buildGuideRequest({ intent, image }),
      (error) => error instanceof GuideAdapterError && error.code === "GOAL_REQUIRED",
    );
  }
  assert.equal(buildGuideRequest({ intent: "explain", image }).intent, "explain");
});

test("private preview returns the exact GuideResult shape with local processing", () => {
  const response = createPreviewGuide({ intent: "identify", image, title: "Example" });
  assert.equal(response.ok, true);
  assert.equal(response.provider, "local");
  assert.equal(response.result.processing.provider, "local");
  assert.equal(response.result.processing.model, "deterministic-preview");
  assert.equal(response.result.intent, "identify");
  assert.match(response.result.warnings[0], /does not analyze image pixels/i);
});

test("result normalization rejects duplicate or malformed step ids", () => {
  assert.throws(() => normalizeGuideResult(validResult({
    steps: [
      { id: "same", title: "One", instruction: "First" },
      { id: "same", title: "Two", instruction: "Second" },
    ],
  })), /invalid or duplicate step id/i);
  assert.throws(() => normalizeGuideResult(validResult({
    steps: [{ id: "not valid", title: "One", instruction: "First" }],
  })), /invalid or duplicate step id/i);
});

test("schema limits track the shared server contract", () => {
  assert.equal(GUIDE_RESULT_SCHEMA.properties.subject.maxLength, 240);
  assert.equal(GUIDE_RESULT_SCHEMA.properties.summary.maxLength, 1_600);
  assert.equal(GUIDE_RESULT_SCHEMA.properties.steps.maxItems, 12);
  assert.equal(GUIDE_RESULT_SCHEMA.properties.completionChecks.maxItems, 10);
  assert.equal(GUIDE_RESULT_SCHEMA.properties.sources.maxItems, 6);
  assert.deepEqual(GUIDE_RESULT_SCHEMA.properties.processing.properties.provider.enum, ["gemini", "openai", "local"]);
});

test("browser AI creates the model directly from the user-triggered path", async () => {
  let created = false;
  let destroyed = false;
  let createOptions;
  let promptOptions;
  let promptInput;
  const languageModel = {
    async create(options) {
      created = true;
      createOptions = options;
      return {
        async prompt(input, options) {
          promptInput = input;
          promptOptions = options;
          return JSON.stringify(validResult());
        },
        destroy() {
          destroyed = true;
        },
      };
    },
  };

  const response = await runBrowserGuide(
    { intent: "identify", image, goal: "Identify the controls" },
    { languageModel },
  );

  assert.equal(created, true);
  assert.equal(destroyed, true);
  assert.equal(createOptions.initialPrompts[0].role, "system");
  assert.match(createOptions.initialPrompts[0].content, /untrusted reference data/i);
  assert.doesNotMatch(JSON.stringify(promptInput), /system instructions/i);
  assert.equal(promptOptions.responseConstraint, BROWSER_GUIDE_RESPONSE_CONSTRAINT);
  assert.equal(response.result.processing.provider, "local");
  assert.equal(response.result.processing.model, "chrome-language-model");
});

test("browser structured output keeps shape constraints but removes prose maxLength limits", () => {
  const serialized = JSON.stringify(BROWSER_GUIDE_RESPONSE_CONSTRAINT);
  assert.doesNotMatch(serialized, /maxLength/);
  assert.equal(BROWSER_GUIDE_RESPONSE_CONSTRAINT.type, "object");
  assert.deepEqual(BROWSER_GUIDE_RESPONSE_CONSTRAINT.required, GUIDE_RESULT_SCHEMA.required);
  assert.equal(BROWSER_GUIDE_RESPONSE_CONSTRAINT.properties.steps.maxItems, 12);
});

test("browser AI rejects credential-exfiltration guidance and destroys the model session", async () => {
  let destroyed = false;
  const languageModel = {
    async create() {
      return {
        async prompt() {
          return JSON.stringify(validResult({
            recommendedAction: {
              title: "Share the account password",
              reason: "Send the password to the page operator to continue.",
            },
          }));
        },
        destroy() {
          destroyed = true;
        },
      };
    },
  };

  await assert.rejects(
    runBrowserGuide({ intent: "identify", image, goal: "Understand this account page" }, { languageModel }),
    (error) => error instanceof GuideAdapterError && error.code === "UNSAFE_GUIDE",
  );
  assert.equal(destroyed, true);
});

test("browser AI rejects high-stakes procedures without warnings and per-step risks", async () => {
  const languageModel = {
    async create() {
      return {
        async prompt() {
          return JSON.stringify(validResult({
            intent: "troubleshoot",
            goal: "Repair electrical wiring",
            warnings: [],
            steps: [{ id: "inspect", title: "Inspect wiring", instruction: "Inspect the wiring." }],
          }));
        },
        destroy() {},
      };
    },
  };

  await assert.rejects(
    runBrowserGuide({ intent: "troubleshoot", image, goal: "Repair electrical wiring" }, { languageModel }),
    (error) => error instanceof GuideAdapterError && error.code === "UNSAFE_GUIDE",
  );
});

test("browser AI rejects unsafe clarification and completion fields", async () => {
  const languageModel = {
    async create() {
      return {
        async prompt() {
          return JSON.stringify(validResult({
            clarificationQuestion: "Please enter your verification code to continue.",
            completionChecks: ["The password was sent to the page operator."],
          }));
        },
        destroy() {},
      };
    },
  };

  await assert.rejects(
    runBrowserGuide({ intent: "explain", image, goal: "Explain this account page" }, { languageModel }),
    (error) => error instanceof GuideAdapterError && error.code === "UNSAFE_GUIDE",
  );
});

test("browser AI scans unsafe clauses after a safely worded opening", async () => {
  const languageModel = {
    async create() {
      return {
        async prompt() {
          return JSON.stringify(validResult({
            warnings: ["Do not share your password publicly, but send your password to support."],
          }));
        },
        destroy() {},
      };
    },
  };

  await assert.rejects(
    runBrowserGuide({ intent: "explain", image, goal: "Explain this account page" }, { languageModel }),
    (error) => error instanceof GuideAdapterError && error.code === "UNSAFE_GUIDE",
  );
});

test("browser AI scans unsafe clauses after punctuation in a safe warning", async () => {
  const languageModel = {
    async create() {
      return {
        async prompt() {
          return JSON.stringify(validResult({
            warnings: ["Do not share your password publicly — send your password to support."],
          }));
        },
        destroy() {},
      };
    },
  };

  await assert.rejects(
    runBrowserGuide({ intent: "explain", image, goal: "Explain this account page" }, { languageModel }),
    (error) => error instanceof GuideAdapterError && error.code === "UNSAFE_GUIDE",
  );
});

test("browser AI allows a direct warning not to disclose a credential", async () => {
  const languageModel = {
    async create() {
      return {
        async prompt() {
          return JSON.stringify(validResult({
            goal: "Review password safety",
            warnings: ["Do not share your password with anyone. Contact qualified account support if access is uncertain."],
            steps: [{
              id: "contact-support",
              title: "Contact support",
              instruction: "Use the official support link without entering credentials into chat.",
              risk: "Stop if the support domain cannot be verified.",
            }],
          }));
        },
        destroy() {},
      };
    },
  };

  const response = await runBrowserGuide(
    { intent: "explain", image, goal: "Review password safety" },
    { languageModel },
  );
  assert.equal(response.result.processing.provider, "local");
});

test("browser AI requires a stop warning for zero-step high-stakes results", async () => {
  const languageModel = {
    async create() {
      return {
        async prompt() {
          return JSON.stringify(validResult({
            intent: "explain",
            goal: "Explain this medication dose",
            warnings: [],
            steps: [],
          }));
        },
        destroy() {},
      };
    },
  };

  await assert.rejects(
    runBrowserGuide({ intent: "explain", image, goal: "Explain this medication dose" }, { languageModel }),
    (error) => error instanceof GuideAdapterError && error.code === "UNSAFE_GUIDE",
  );
});

test("cloud adapter is locked to the trusted backend and omits cookies", async () => {
  assert.equal(endpointForBackendOrigin(), `${TRUSTED_BACKEND_ORIGIN}/api/guide`);
  assert.equal(originPermissionForBackend(), `${TRUSTED_BACKEND_ORIGIN}/*`);
  assert.throws(() => endpointForBackendOrigin("https://example.com"), /only trusts/i);

  let call;
  const response = await runCloudGuide(
    { intent: "identify", image, goal: "Identify the controls" },
    {
      backendOrigin: TRUSTED_BACKEND_ORIGIN,
      fetchImpl: async (url, options) => {
        call = { url, options };
        return new Response(JSON.stringify({
          ok: true,
          result: validResult(),
          provider: "local",
          model: "test-model",
          requestId: "req-test",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  );
  assert.equal(call.url, `${TRUSTED_BACKEND_ORIGIN}/api/guide`);
  assert.equal(call.options.credentials, "omit");
  assert.equal(call.options.redirect, "error");
  assert.equal(response.requestId, "req-test");
});
