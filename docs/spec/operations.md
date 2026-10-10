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
