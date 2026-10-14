# Theme creation

Prefix: THM

[THM-001] The starter provides a documented, typed theme SDK with semantic tokens for color, typography, radius, shadow, spacing, and page width. A registered custom theme can supply those values without changing application components. The saved shadcn/ui preset remains available with every existing control, and the visitor's light or dark choice changes only the effective mode.
Falsifier: A valid custom theme cannot change a representative public and admin surface through tokens, a missing or invalid token silently produces broken CSS, selecting a custom theme removes a pinned preset control, or changing visitor mode changes saved theme values other than its light or dark tokens.
Mechanism: theme-sdk
Status: Agreed 2026-10-10

[THM-002] The application renders its own theme values through stylesheets and semantic classes rather than HTML style attributes or authored style elements. An administrator can preview and select installed themes and public page templates. The choice persists across navigation and restart; a template changes public layout without changing content, access rules, metadata, or responsive readability.
Falsifier: A first-party component still emits a style attribute or authored style element, preview differs from the saved theme or template, a selection disappears after restart, or switching templates changes eligible content or causes horizontal scrolling at 320 pixels in light or dark mode.
Mechanism: theme-sdk
Status: Agreed 2026-10-10

[THM-003] The repository includes an agent skill for creating a custom theme, public template, and brand kit through the SDK. It identifies the token, template, and brand extension points, registration and preview steps, and checks that protect the existing preset and public behavior. A newly created example theme and template demonstrate the path without editing page components.
Falsifier: Following the skill cannot produce a registered theme or template with a visible preview and saved selection, cannot set brand assets, requires inline CSS or edits to application page components, or lacks a way to validate tokens and the relevant build and behavior checks.
Mechanism: theme-sdk
Status: Agreed 2026-10-10

[THM-004] An administrator can change the site's name, description, logo image, favicon, and default social card through protected branding controls, using validated public asset paths, HTTP(S) asset URLs, or safe image uploads. The brand appears in the header, page metadata, and fallback social metadata after navigation and restart. Generated listing social cards use the current brand's identity and theme colors. Explicit published content images and the existing SEO social-image setting keep priority over the brand fallback. Current uploaded assets are included in the documented backup and restore set.
Falsifier: A guest changes branding, an invalid or oversized upload is served, a saved logo or favicon is missing after restart or restore, old branding remains in the header or default social metadata, a generated listing card keeps the old identity or palette, or a published custom social image is replaced by the brand fallback.
Mechanism: theme-sdk
Status: Agreed 2026-10-10

[THM-005] The selected preset body and heading fonts load without a render-blocking external font stylesheet on initial public and admin pages. Every listed preset font remains available after preview, save, navigation, and restart. Text remains visible while a font loads, and a registered custom theme keeps its declared typography.
Falsifier: Initial rendering waits for a Google Fonts stylesheet, any listed preset font fails to load when selected for body or heading text, text disappears while a font loads, a saved choice changes after restart, or selecting a custom theme changes its declared typography.
Mechanism: font-loading
Status: Agreed 2026-10-10
