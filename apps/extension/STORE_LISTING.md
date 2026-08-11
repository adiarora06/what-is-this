# Chrome Web Store submission — What Is This? Guide v0.3.0

This file is the copy-and-paste source of truth for the first Chrome Web Store submission. Generate the upload artifact with `npm --prefix apps/extension run package:store`, then upload `apps/extension/dist/what-is-this-guide-v0.3.0.zip`.

The packaging command accepts only Manifest V3 version 0.3.0 with the `activeTab`, `sidePanel`, and `storage` permissions. It packages an explicit runtime allowlist with `manifest.json` at the ZIP root; documentation, tests, store artwork, and development files are excluded.

## Public store listing

**Name**

> What Is This? Guide

**Summary**

> Capture the visible tab and get private guidance with Chrome's on-device AI on supported desktop devices.

**Category**

> Productivity

**Language**

> English (United States)

**Detailed description**

> Understand what is visible in your current Chrome tab without leaving the page.
>
> What Is This? Guide captures only the visible area of the active tab after you choose “Capture visible tab privately.” Chrome’s built-in on-device AI analyzes that temporary image and returns a structured guide in Chrome’s side panel.
>
> Choose whether you want to identify, explain, troubleshoot, compare, or follow a step-by-step process. Add an optional goal, crop the capture to what matters, and answer one clarification question when the guide needs more context.
>
> Privacy by design:
> • Processing happens on your device with Chrome’s built-in AI.
> • Screenshots and your typed context are held only in Chrome session storage.
> • Nothing is uploaded to us or another guide server.
> • No account, subscription, advertising, analytics, or tracking is included.
> • The extension does not separately access the page URL, page title, DOM, form fields, cookies, password manager, or browsing history.
> • A screenshot can contain sensitive information that is visible on the page; review the page and crop before processing it.
>
> Requires Chrome 148 or newer on a supported desktop device because screenshot guidance uses the multimodal Prompt API. Chrome may need to download its on-device model before the first guide can be created.

**Single purpose**

> After an explicit user request, capture the visible area of the active tab and use Chrome’s on-device AI to explain what is shown and provide structured next steps in the side panel.

**Mature content**

> No

## URLs

Verify that each URL is public before submission.

- Homepage URL: `https://what-is-this-mobile.vercel.app/`
- Privacy policy URL: `https://what-is-this-mobile.vercel.app/privacy`
- Support URL: `https://github.com/adiarora06/what-is-this/issues`
- Official URL: `https://what-is-this-mobile.vercel.app/` after domain ownership is verified in Google Search Console

## Privacy practices dashboard

### Prominent in-product disclosure

The following disclosure must be visible before the capture action:

> Before you capture: When you press “Capture visible tab privately,” Chrome takes a screenshot of only the visible area of your active tab so its built-in AI can create your guide. The screenshot includes everything currently visible, so do not capture passwords, security codes, financial or health records, or private messages. It is processed on this device, kept only for the current Chrome session, and is not sent to us or any third party.

### Permission justifications

**`activeTab`**

> Provides temporary access to the active tab only after the user invokes the extension. It is used solely by `chrome.tabs.captureVisibleTab()` to capture the visible viewport and is revoked when the user navigates to another origin or closes the tab.

**`sidePanel`**

> Opens and displays the extension’s guide beside the current page so the user can follow the result without leaving their task.

**`storage`**

> Uses `chrome.storage.session` to share the current screenshot, selected intent, typed goal or clarification, and generated guide between extension contexts during the current Chrome session. Version 0.3.0 writes no guide data or settings to local or sync storage; during an update it removes one obsolete local processing-mode preference from the preview build.

There are no host permissions, optional permissions, or `tabs`, `scripting`, or `contextMenus` permissions in this release.

### Remote code

Select:

> No, I am not using remote code.

All extension logic is packaged in the ZIP. Chrome supplies and manages its built-in on-device AI model; the extension does not download or execute JavaScript, WebAssembly, commands, or other logic from a remote source.

### Data types

Use the exact data-type names shown in the current dashboard at submission time. At minimum, select:

- **Website content:** the user-initiated screenshot of the visible tab.
- **User-provided or user-generated content**, if the current form offers it: the optional goal or clarification text the user deliberately supplies for that guide.

A capture can contain any information visible on screen, including personal identifiers, messages, authentication codes, financial details, form data, or health information. If the current form asks whether the handled website content can include those semantic categories, select every applicable category and explain that the content is user-selected, processed only on-device, retained only for the Chrome session, and never transmitted. Do not select web history, location, or background user activity: the extension does not read URLs, titles, DOM, cookies, history, analytics events, or activity outside the explicit screenshot.

### Data-use certification

Certify that:

- Data is used only to create the user-requested guide.
- Data is not sold, transferred, or used for advertising, profiling, creditworthiness, or an unrelated purpose.
- Data is not sent to the developer or a third party and is not read by humans.
- Screenshots and typed context remain in `chrome.storage.session`, which clears when Chrome restarts or the extension is reloaded, updated, or disabled.
- The dashboard declarations, in-product disclosure, public listing, and privacy policy all describe the same behavior.

## Compatibility and reviewer test instructions

No account, payment, credentials, special website, or external service is required.

**Environment**

- Chrome 148 or newer.
- Supported desktop platform: Windows 10/11, macOS 13 or newer, Linux, or Chromebook Plus.
- Chrome’s Prompt API hardware requirements must be met. Google currently documents at least 22 GB of free profile-volume storage and either more than 4 GB of GPU memory or at least 16 GB of RAM and four CPU cores.
- An unmetered connection may be needed for Chrome’s first on-device model download. Captures are not sent with that download.

**Test steps**

1. Open a normal webpage with a clearly visible object or interface.
2. Select the extension’s toolbar icon. Confirm that the side panel opens and shows the capture disclosure before any screenshot exists.
3. Choose **Capture visible tab privately**. Confirm that a preview of only the visible viewport appears.
4. Optionally apply a crop, select an intent, and enter a short goal.
5. Confirm that **Chrome on-device AI** is available, then choose **Guide on this device**. While Chrome downloads or runs the model, confirm that **Cancel guide** remains available; cancelling restores the guide controls, and an unattended request times out after three minutes.
6. Confirm that the result contains a subject, summary, recommended action, and—when applicable—evidence, steps, completion checks, warnings, or one clarification question.
7. If a clarification question appears, enter an answer and choose **Update guide**. Confirm that the existing capture is reused without another screenshot.
8. Choose **Start over** and confirm that the capture and guide are cleared.

If `LanguageModel.availability()` reports that the model is unavailable, use a device that meets the environment requirements above. The extension should explain this compatibility state rather than upload the screenshot or silently switch to a remote model.

## Distribution sequence

1. Register the publisher, verify its contact email, enable 2-Step Verification, and complete the Trader or Non-Trader declaration.
2. Submit v0.3.0 as **Private — Only trusted testers** first. Add tester Google Accounts in the publisher settings.
3. Install the reviewed private build from the Chrome Web Store and complete the test instructions on at least one supported Windows or macOS device.
4. Resolve any review or tester findings, increment the version for any changed package, and regenerate the ZIP.
5. Change distribution to **Public**, choose all intended regions, enable deferred publishing, and submit for public review.
6. After approval, complete a final listing and privacy check, then publish within the dashboard’s 30-day staged-submission window.

Private, unlisted, and public items receive the same Chrome Web Store policy review. Do not create a duplicate beta listing unless its name ends in “BETA” or “DEVELOPMENT BUILD” and its description clearly states that it is for testing.

## Store assets

Prepare these exact files outside the extension ZIP:

- `apps/extension/icons/icon-128-store.png` — required 128×128 PNG store icon with 16 px transparent padding and packaged extension icon.
- `apps/extension/store-assets/screenshot-01-capture-1280x800.png` — required full-bleed capture workflow screenshot.
- `apps/extension/store-assets/screenshot-02-guide-1280x800.png` — recommended full-bleed completed guide screenshot.
- `apps/extension/store-assets/screenshot-03-clarification-1280x800.png` — recommended full-bleed clarification workflow screenshot.
- `apps/extension/store-assets/small-promo-440x280.png` — required PNG or JPEG small promotional tile.
- `apps/extension/store-assets/marquee-promo-1400x560.png` — optional PNG or JPEG marquee tile.

Use only real extension UI in screenshots. Keep screenshot corners square with no added padding, avoid dense text in promotional artwork, and verify that every visible statement matches v0.3.0 behavior.

## Final submission check

- [ ] `npm --prefix apps/extension run verify` passes.
- [ ] Store asset validation reports all five required images and the 16 px icon safe area.
- [ ] `npm --prefix apps/extension run package:store` succeeds and reports exactly 14 files.
- [ ] The ZIP filename and manifest version are both v0.3.0.
- [ ] All three declared permissions match the justifications above.
- [ ] The production privacy policy and support URL are public.
- [ ] The dashboard data types and certifications match the extension behavior.
- [ ] The required icon, first screenshot, and small promotional tile are uploaded.
- [ ] Reviewer instructions contain no personal credentials.
- [ ] Initial visibility is Private — Only trusted testers.
