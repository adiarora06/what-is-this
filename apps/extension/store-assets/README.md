# Store asset provenance

These assets are publication materials only and are excluded from the extension upload ZIP.

## Screenshots

`screenshot-01-capture-1280x800.png`, `screenshot-02-guide-1280x800.png`, and `screenshot-03-clarification-1280x800.png` are deterministic renders of the extension's actual `sidepanel.html`, `sidepanel.css`, and `sidepanel.js` at 1280×800. The local renderer supplies a harmless sample plant-care page and fixed extension session data; it does not substitute a separately designed panel. Recreate them with:

```bash
npm --prefix apps/extension run render:store
```

## Small promotional tile

`small-promo-440x280.png` was created in image-generation mode with the existing `icons/icon-128.png` brand mark as the visual reference, then deterministically resized to the required 440×280 dimensions.

Prompt:

> Create a polished Chrome Web Store small promotional tile for the existing product mark in the reference image. Landscape composition, exact target aspect ratio 11:7 (440x280). Use the product's warm off-white background, near-black ink, deep forest green, soft mint, and a tiny warm amber accent. Show an abstract browser window on the left and a clean companion side panel on the right, with a crop frame over a harmless everyday object and tidy guide cards/steps in the panel. Include the referenced black rounded-square question-mark brand mark once, with generous breathing room. Flat premium vector-like product illustration, subtle depth, crisp geometry, accessible contrast. No words, no letters besides the question-mark logo, no Google or Chrome logos, no gradients that muddy the artwork, no people, no screenshots, no device hardware frame. The result must feel trustworthy, private, useful, and production-ready for a browser assistant listing.

## Marquee promotional tile

`marquee-promo-1400x560.png` was created in image-generation mode using the small promotional tile, the real extension screenshots, and the Store icon as visual references, then deterministically resized to 1400×560. It is an opaque 24-bit RGB PNG with no alpha channel.

Prompt:

> Create a polished 2.5:1 Chrome Web Store marquee companion to the small promotional tile. Preserve the warm cream background, deep evergreen and pale mint palette, soft shadows, and small gold accents. Show a simplified browser with a snake plant being scanned across the left two-thirds, a slim AI guide side panel near the center-right with abstract mint cards, and the official extension icon as a smaller floating badge on the far right. Communicate visible-tab capture and private on-device guidance without words. Use crisp premium flat-vector product marketing art, generous safe padding, and a fully opaque background. No words, letters, numbers, watermarks, people, generic robots, distorted browser frames, or extra floating icons.

## Store icon

`../icons/icon-128-store.png` preserves the existing brand artwork at 96×96 on a transparent 128×128 canvas, giving it the Chrome Web Store's recommended 16 px safe area. It is a deterministic resize/pad operation, not generated artwork.

Validate all required dimensions and the icon's alpha padding with:

```bash
npm --prefix apps/extension run validate:store-assets
```
