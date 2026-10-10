# Operator operations

Prefix: OPS

[OPS-001] The starter documents and verifies a backup and isolated restore of its SQLite database, uploaded media, and the matching billing encryption key without overwriting the source installation or exposing secrets. A restored installation retains approved content and decryptable provider settings.
Falsifier: Following the documented steps produces an inconsistent SQLite copy, loses approved media or encrypted settings, overwrites the live installation, prints a secret, or claims a restore succeeded when its matching key or media is missing.
Mechanism: operator-adoption
Status: Agreed 2026-10-10

[OPS-002] The starter provides an upgrade guide for its actual runtime and lockfile that distinguishes fresh installation from an existing operator database, places a recoverable backup before migration, runs the documented build and migration checks, and gives an explicit rollback path for data and media.
Falsifier: A documented command fails from a clean checkout, an upgrade step reseeds or replaces existing operator data, the guide names incompatible versions or claims migrations can be reversed without restoring a matching backup, or rollback omits media or the encryption key.
Mechanism: operator-adoption
Status: Agreed 2026-10-10

[OPS-003] The starter supplies a buildable production Docker image and a Compose deployment for one host. The container runs as a non-root user, reads site settings and secrets only at runtime, and persists its SQLite database and uploaded media outside the image across container replacement. The operator can run migrations, optional sample seed, notification delivery, billing reconciliation, and the existing verified backup and restore scripts against that same data through documented container commands. The Compose service binds locally for a reverse proxy and reports health without changing data.
Falsifier: A clean Docker build or documented Compose start fails; a secret or operator database enters the image; the container cannot write its data volume; a container replacement loses content or media; a container command targets a different database; a restart seeds or migrates unexpectedly; the app cannot be reached through the documented port; or the health check reports success while the public page fails.
Mechanism: container-deployment
Status: Agreed 2026-10-10
