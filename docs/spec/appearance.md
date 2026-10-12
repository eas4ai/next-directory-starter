# Visitor appearance

Prefix: UI

[UI-001] A visitor can choose light or dark appearance independently of other visitors and retain that choice across navigation and reload. Initial server HTML uses a valid saved choice; without one, the administrator's preset mode still applies. The visitor choice overrides only the preset's mode, leaving its other saved controls intact.
Falsifier: The switch cannot be used by keyboard, a saved choice is lost or applied only after hydration, a malformed choice changes rendering, one visitor changes another's appearance, a preset color or font changes with the visitor choice, or content becomes unreadable at 320 pixels in either mode.
Mechanism: operator-adoption
Status: Agreed 2026-10-10
