---
name: create-directory-theme
description: Create or revise a registered theme, public page template, and brand kit for this directory through its theme SDK.
---

# Create a directory design

Use this skill when the operator asks for a custom look for this repository. Start from the existing `studio` theme and `editorial` template. Keep content eligibility, routes, metadata precedence, and staff access as they are.

## Theme tokens

Read `src/lib/theme-sdk.ts` and `src/themes/studio.ts`. Add a theme definition in `src/themes/` with a unique lowercase ID and every required light and dark semantic color, typography, radius, shadow, control height, spacing, width, and social-card color. Type it with `satisfies ThemeDefinition`; `defineTheme` validates it at runtime. Register it in `src/themes/index.ts`. Use semantic token names such as `primary` and `sidebar`, rather than page-specific color overrides. The saved shadcn preset stays available; do not replace its options or stored value.

## Public template

Read `src/templates/editorial.css`, the `template-*` classes on public pages, and `src/lib/theme-selection.ts`. Add a CSS file in `src/templates/`, import it from `src/app/globals.css`, and register its ID and display name in `templateOptions`. Scope layout rules with `[data-template="your-id"]`; use `var(--theme-*)` and other semantic tokens for visual values. A template changes layout through shared classes. It should not need edits to page components or authored HTML style attributes/elements. Test at 320px and a wide viewport in both modes.

## Brand kit

Use the protected `/admin/branding` controls for the site name, description, logo, favicon, and default social image. Upload image assets there or supply validated public paths or HTTP(S) URLs. Keep the original asset files in the media backup set. Read `src/lib/branding.ts` before changing brand behavior; generated listing cards read its identity and the theme's social palette. An explicit published content image or SEO social-image setting takes priority over the brand fallback.

## Preview and verify

Open `/admin/theme` as an administrator. Preview the token palette and template, then save the installed theme and template. Inspect `/theme.css`, a public listing and article, the admin page, and the social card. Confirm the visitor appearance switch changes only light or dark mode. Run `node --import tsx --test tests/theme-sdk.test.mjs`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`. Check saved selection after navigation and restart. If a theme or template is removed, confirm the site falls back safely to the saved preset and classic template.
