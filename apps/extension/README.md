# What Is This? Guide — Chrome extension

A self-contained Manifest V3 side-panel extension that turns a user-requested screenshot of the visible tab into a structured guide with Chrome's built-in on-device AI. The Store release has no build step, runtime dependencies, content scripts, remote scripts, network requests, analytics, accounts, or broad site access.

## Requirements

- Chrome 148 or newer on desktop. Screenshot guidance depends on the multimodal Prompt API available at that release level.
- A device supported by Chrome's Prompt API. Chrome may need to download its on-device model before the first guide.
- A normal capturable webpage. Chrome's own pages and some protected pages cannot be captured.

When the on-device model is unavailable, the panel explains the compatibility requirement. It does not create a mock answer or upload the screenshot to a fallback service.

## Load the unpacked extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `apps/extension` directory.
4. Open a normal webpage and select the extension's toolbar icon.
5. Read the capture disclosure, then choose **Capture visible tab privately**.
6. Optionally crop the preview, choose a quick question or add your own goal, and select **Create guide on this device**.

The panel reveals one stage at a time. After a result, you can check off steps, copy or retry the guide, recapture the tab, ask a new question, or ask a follow-up without taking another screenshot. Press **Ctrl+Shift+Y** (or **Command+Shift+Y** on macOS) to open the extension from the keyboard.

## Privacy and permissions

Before every new capture, the side panel explains what will be captured, why it is needed, how it is processed, how long it is retained, and that it is not sent to the developer or a third party.

- `activeTab` allows one visible-viewport screenshot after the user invokes the extension on that tab.
- `sidePanel` keeps the guide beside the current page.
- `storage` keeps recent captures, typed context, checked steps, and results in tab-isolated `chrome.storage.session`.

The extension does not separately access the page URL, page title, selected text, DOM content, form fields, cookies, password manager, browsing history, account APIs, or background-tab activity. A screenshot can still contain any information visibly displayed on the page, so the panel warns against capturing passwords, security codes, financial or health records, and private messages. Captures are bounded JPEGs, Incognito is disabled, and no more than three recently used tab sessions are retained. A tab's data is removed on Start over or tab close; all remaining data clears with the browser session. See the public [privacy policy](https://what-is-this-mobile.vercel.app/privacy).

## On-device guide safety

The adapter keeps system policy separate from untrusted screenshot and user text, constrains and validates the structured result, blocks credential requests, direct medication dosing, and destructive guidance, applies extra checks to high-stakes responses, rejects invented source links, and destroys the model session after each request. A visible cancel action and a three-minute timeout prevent a stalled model download or response from locking the panel.

## Verify and package

The packaged extension has no runtime dependencies. Repository development installs provide Playwright for the browser-level UI verification and Store screenshot renderer. From the repository root:

```bash
npm --prefix apps/extension run verify
npm --prefix apps/extension run render:store
npm --prefix apps/extension run validate:store-assets
npm --prefix apps/extension run package:store
```

The packaging command validates version 0.4.0, requires exactly `activeTab`, `sidePanel`, and `storage`, and creates a deterministic allowlisted ZIP with `manifest.json` at its root:

```text
apps/extension/dist/what-is-this-guide-v0.4.0.zip
```

`render:store` creates three 1280×800 listing screenshots from the extension's actual HTML and CSS with deterministic sample data. `validate:store-assets` checks all required dimensions plus the Store icon's transparent safe area. Store listing copy, privacy answers, reviewer instructions, and the asset checklist are in `STORE_LISTING.md`. Store artwork is intentionally excluded from the upload ZIP.
