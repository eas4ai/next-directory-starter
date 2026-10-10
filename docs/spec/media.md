# Media

Prefix: MED

[MED-001] An authenticated listing owner or editor can upload an image to a private local store for their own listing draft or article. The server accepts decoded JPEG, PNG, or WebP images no larger than 5 MiB or 4096 pixels on either side, re-encodes accepted pixels without source metadata, and rejects SVG, invalid data, and unauthorized writes without changing the content revision.
Falsifier: A wrong owner uploads to a draft, an oversized or forged image is accepted, source metadata survives the stored image, a rejected upload changes the draft, or an accepted upload disappears after restart.
Mechanism: content-notifications
Status: Agreed 2026-10-09

[MED-002] Draft media is readable only by its owner or an authorized editor, while public media follows the current listing or article publication state. A pending listing revision keeps its last approved image public until approval; suspension or unpublication removes the public image at once.
Falsifier: A guest fetches draft media, another owner reads it, unreviewed media appears publicly, or an image remains public after its listing is suspended or article unpublished.
Mechanism: content-notifications
Status: Agreed 2026-10-09
