# What Is This? Guide — Chrome extension MVP

A self-contained Manifest V3 side-panel extension for capturing the visible tab and turning it into a structured `GuideResult`. It has no build step, runtime package dependencies, content scripts, remote scripts, or broad site access.

The packaged toolbar and Store icons reuse the existing What Is This? app mark so the browser companion remains part of the same product family.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `apps/extension` directory.
4. Open a normal HTTPS page and click the extension’s toolbar action.
5. Choose **Capture visible tab**, optionally drag over the preview or use the keyboard-accessible center crop, select an intent, and make a guide.

You can also right-click a page, text selection, or image and choose the matching What Is This? command. The context-menu gesture captures the visible tab and opens the side panel.

## Processing modes

- **Private preview** is the default. It returns a deterministic, schema-valid mock result and explicitly does not claim to analyze screenshot pixels.
- **Chrome on-device AI** is shown only when the feature-detected `LanguageModel` API supports text and image input. It separates system policy from untrusted page content, validates a structured result, applies a deterministic safety gate, destroys the model session after each request, and falls back only by asking the user to choose another mode. When the model needs one missing detail, you can answer its clarification question in the side panel and update the guide without recapturing the tab; the bounded reply stays in the same on-device processing flow. The manifest intentionally does not include the expired `aiLanguageModelOriginTrial` permission.
- **Trusted guide API** is visibly disabled in this MVP. **Open web settings** opens the normal production Settings page without sending the screenshot, page address, selection, or an account token; it is a setup path, not an authorization exchange. The manifest grants no host access and the UI cannot upload a capture until a scoped, one-time verification handoff and explicit send consent are implemented.

Production `/api/guide` may require a fresh Turnstile token. This no-remote-code MVP does not embed Turnstile or weaken the route, so the upload path stays disabled instead of sending an image into a request that production would reject.

## Data and permissions

- `activeTab`: one visible-tab screenshot after an extension toolbar or context-menu gesture.
- `contextMenus`: page, selection, and image entry points.
- `sidePanel`: persistent extension UI beside the page.
- `storage`: capture/draft/result state in `chrome.storage.session`; the processing-mode preference in `chrome.storage.local`.
- No host permission is packaged in the MVP, Incognito is disabled, and captures cannot be uploaded from the panel. Opening web Settings creates a normal tab and does not broaden extension access.

Screenshots are bounded JPEG captures of the visible viewport only. Each normal Chrome window has an isolated session; its capture and any in-progress clarification reply are removed on reset, when that window closes, or when Chrome exits. Protected browser pages and file URLs can reject capture. Opening the panel from Chrome’s generic side-panel picker may not grant `activeTab`; click the toolbar action on the target tab if capture asks for a fresh gesture.

## Shared contract

The adapter sends `{ intent, image?, goal?, pageContext?, selection?, url?, title? }` and renders the repository’s `GuideResult` fields directly: subject, intent, goal, summary, confidence, evidence, recommendation, steps, alternatives, warnings, clarification question, completion checks, sources, and processing metadata.

The extension keeps a local copy of the runtime validation limits because unpacked extensions cannot import the Next.js TypeScript module. Tests pin the important limits and provider values to prevent drift.

## Verify

Requires the repository’s Node 22+ runtime; there is nothing to install.

```bash
cd apps/extension
npm run verify
```

`verify` syntax-checks all extension JavaScript and runs the dependency-free Node test suite for the manifest, adapter contract, clarification follow-ups, prompt-safety gate, storage isolation, capture recovery, trusted-origin boundary, and preview result.
