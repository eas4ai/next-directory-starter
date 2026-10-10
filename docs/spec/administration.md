# Administration

Prefix: ADM

[ADM-001] The application enforces administrator permissions on review, editorial, commerce, and site-configuration actions.
Falsifier: An account lacking a permission completes its protected action by sending the request directly.
Mechanism: admin-permissions
Status: Agreed 2026-10-09

[ADM-002] The application records who performed a moderation, publication, payment-setting, or role change and when it happened.
Falsifier: A completed protected change has no actor and time in audit history.
Mechanism: admin-audit
Status: Agreed 2026-10-09

[ADM-003] The application lets an authorized administrator inspect pending submissions and their review history.
Falsifier: A submitted listing is missing from the review view, or its prior decision cannot be read there.
Mechanism: admin-review
Status: Agreed 2026-10-09

[ADM-004] The application restricts the theme editor and theme changes to authenticated administrators.
Falsifier: A visitor or signed-in non-administrator can open the editor or save a preset through a direct request.
Mechanism: admin-theme
Status: Agreed 2026-10-09

[ADM-005] The theme editor lets an administrator preview and save every choice of the pinned shadcn/ui preset: style, base color, theme color, chart color, icon library, body font, heading font, radius, menu accent, and menu color, plus light, dark, and system mode.
Falsifier: An official option for any named control is absent, or selecting it fails to change the preview and saved preset.
Mechanism: admin-theme
Status: Agreed 2026-10-09

[ADM-006] The application applies the administrator's saved theme preset across public and administrative pages after navigation and restart.
Falsifier: Saving a nondefault preset leaves a directory page or admin page with a default value for any saved choice after a restart.
Mechanism: admin-theme
Status: Agreed 2026-10-09

[ADM-007] The operator can provision the first administrator without offering public accounts a way to grant themselves administrator access.
Falsifier: A fresh installation has no documented admin provisioning path, or a visitor can self-assign the administrator role.
Mechanism: admin-theme
Status: Agreed 2026-10-09
