# Responsive design QA

## Source of truth

- Approved mobile reference: `docs/screenshots/scan-mobile.png`
- Reference state: initial Scan view, empty camera, no saved objects
- Reference viewport: 390 × 844 CSS pixels, 1× density
- Existing design language retained: warm off-white canvas, black and evergreen actions, Inter typography, compact rounded cards, and three-item navigation

## Implemented surfaces

- Phone portrait: `docs/responsive-audit/09-mobile-final.png` at 390 × 844
- Phone landscape: `docs/responsive-audit/12-phone-landscape-final.png` at 844 × 390
- Tablet portrait: `docs/responsive-audit/08-tablet-final.png` at 834 × 1112
- Tablet landscape: `docs/responsive-audit/13-tablet-landscape-final.png` at 1112 × 834
- Desktop Scan: `docs/responsive-audit/07-desktop-final.png` at 1440 × 1000
- Desktop Saved: `docs/responsive-audit/11-desktop-saved-final.png` at 1440 × 1000
- Desktop Settings: `docs/responsive-audit/10-desktop-settings-final.png` at 1440 × 1000

## Same-input visual comparisons

- Mobile source/build comparison: `docs/responsive-audit/14-mobile-source-comparison.png`
- Desktop before/after comparison: `docs/responsive-audit/15-desktop-before-after.png`
- Full views were compared at matching viewport sizes and the same initial Scan state. A separate crop was unnecessary because typography, controls, card edges, and spacing were legible at native size.

## Findings and fixes

1. **P1 — desktop composition used a narrow phone column.** Replaced the fixed centered mobile composition with a bounded two-column desktop shell, persistent side navigation, and a wide scan workspace.
2. **P1 — viewport height stretched grid rows and produced large internal gaps.** Added start alignment to the shell and view grids so content keeps its intended rhythm on tall displays.
3. **P1 — Settings Labs could overlap Privacy on desktop.** Scoped the grid selectors to section panels and added a geometry regression assertion that prevents panel collisions.
4. **P2 — tablet and landscape layouts were implicit rather than verified.** Added explicit tablet portrait and landscape projects plus overflow and placement assertions across all breakpoints.
5. **P2 — desktop Saved and Settings underused horizontal space.** Saved cards now support a two-column content grid, while Settings uses a 12-column composition with clear primary and secondary groups.

## Final review

- Typography, copy, colors, border radii, shadows, and controls match the approved mobile source.
- Mobile portrait remains visually equivalent to the approved design.
- Navigation and primary controls remain usable in portrait and landscape without horizontal overflow.
- Desktop and tablet views use the available width without hiding, duplicating, or changing core interactions.
- Automated verification: TypeScript passed; 28 unit tests passed; production build passed; 25 end-to-end tests passed and 17 intentionally inapplicable project checks skipped.

final result: passed
