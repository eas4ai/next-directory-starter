# Agent-assisted directory ingestion

Prefix: ING

[ING-001] A verified administrator or account with catalog-management capability can connect Claude Code to a documented remote HTTP MCP endpoint using an expiring, revocable, account-bound credential. On a supported browser, the authenticated catalog import page also exposes the same import actions through WebMCP. Every invocation checks the account's current verification, suspension, and catalog capability; guests and other accounts cannot discover private data or perform import actions.
Falsifier: Claude Code cannot list and call the documented tools; a revoked credential, suspended account, removed catalog capability, guest browser, or ordinary listing owner can stage or publish a listing; a browser tool is registered for an unauthorized account; or a credential appears in a tool result, log, or stored plaintext.
Mechanism: agent-ingestion
Status: Agreed 2026-10-10

[ING-002] An authorized agent can use agent-browser to inspect a single URL, a directory page, or a list of links and their destinations, generate summaries and descriptions from those observations, then send one or up to 20 public HTTP(S) destinations, source references and excerpts, titles, summaries, descriptions, and existing categories to the directory per call. The directory validates each item and stages accepted links as private operator-managed drafts with provenance. Repeating an item with the same account-bound idempotency key does not create another listing; invalid or duplicate items return individual results without losing valid items. The directory does not fetch arbitrary submitted destinations.
Falsifier: A single observed URL or a batch of valid links cannot be staged, a rejected item prevents a valid neighbor from being saved, a retry creates a duplicate, a missing source reference or excerpt or invalid category is accepted, a submitted URL makes the server fetch a private address, or a staged listing appears publicly before publication.
Mechanism: agent-ingestion
Status: Agreed 2026-10-10

[ING-003] An authorized administrator or catalog staff member can preview a staged import and explicitly publish it through MCP or the catalog interface. Publication records the actor and time and makes the reviewed text and destination public; an account lacking catalog capability cannot publish it by direct request. Source text supplied by external pages is treated as data and cannot instruct the server to change roles, settings, or publication state.
Falsifier: Staging alone publishes a listing, a guest or account without catalog capability publishes one, publication has no actor and time in audit history, the public page differs from the reviewed staged fields, or source text triggers a protected action.
Mechanism: agent-ingestion
Status: Agreed 2026-10-10

[ING-004] An agent can attach an optional agent-browser screenshot to its staged import. The server accepts only a decoded JPEG, PNG, or WebP no larger than 5 MiB or 4096 pixels on either side, strips source metadata, and keeps the raw screenshot private. The directory generates a branded 1200-by-630 PNG social card using that screenshot when present, or a text design otherwise, together with the staged title, summary, and site identity. An authorized staff member can preview the draft card; public Open Graph and Twitter metadata use the card for the current published listing unless an explicit published social-image override exists. A draft or ineligible listing has no public card, and unsafe text cannot escape into executable image markup.
Falsifier: A forged or oversized screenshot is accepted, a guest reads a draft screenshot or card, the card omits an attached screenshot or has the wrong dimensions or listing identity, a suspended listing's card remains public, published metadata points to a missing or different card, a saved custom social image is replaced, or submitted text executes as markup.
Mechanism: agent-ingestion
Status: Agreed 2026-10-10
