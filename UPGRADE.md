# Install, upgrade, and rollback

This repository uses Node.js 22.12 or newer and npm. The committed lockfile currently installs Next.js 16.4.2, React 19.3.0, and TypeScript 6.0.3. Use `npm ci` so the lockfile determines the installed versions. Keep the database, uploaded media, `BETTER_AUTH_SECRET`, and `BILLING_ENCRYPTION_KEY` on persistent storage outside the checkout. Do not commit an environment file or either secret.

## Fresh installation

Create a new, empty SQLite database path. Copy `.env.example` to `.env.local`, set the public origins and unique secrets, and provide a persistent `MEDIA_DIR`. Configure Resend before opening public registration. Then run:

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run build
npm run start
```

`db:seed` adds replaceable sample listings to an empty site. Provision the first administrator as described in [README.md](README.md). For an empty directory with no examples, omit `db:seed`.

## Existing installation

Record the currently deployed Git commit or release artifact so that the old application and its matching lockfile can be restored. Stop the web process, notification job, and billing reconciliation job. Stop all writes to SQLite and `MEDIA_DIR` before the backup. Keep the current production environment loaded, including `DATABASE_URL`, `MEDIA_DIR`, and `BILLING_ENCRYPTION_KEY`. Preserve `BETTER_AUTH_SECRET` in the secret manager as well.

Choose private paths outside the checkout. The backup output must not already exist. The key file must hold exactly the current `BILLING_ENCRYPTION_KEY`; neither command prints it. Back up **before** checking out new code or running a build or migration, because both the build and app imports may open the database.

```sh
umask 077
BACKUP_ROOT=/secure/location
BACKUP_DIR="$BACKUP_ROOT/pre-upgrade-backup"
KEY_FILE="$BACKUP_ROOT/billing.key"
printf '%s' "$BILLING_ENCRYPTION_KEY" > "$KEY_FILE"
npm run ops:backup -- --output "$BACKUP_DIR" --key-file "$KEY_FILE"
```

Keep the backup directory and key private. The command checks SQLite integrity, uploaded media, and whether the key decrypts saved billing profiles. It refuses an existing destination. Make an isolated test restore before the upgrade and verify an approved listing, its image, and a billing profile against that copy.

Deploy the desired code revision and its committed `package-lock.json`. With the same production environment and the application still stopped, run:

```sh
npm ci
npm run db:migrate
npm run build
npm run lint
npx tsc --noEmit
npm run start
```

The migration command is intended for an existing database and preserves operator records. Do not reseed an existing installation. Check staff sign-in, a public approved listing and image, article output, and the configured billing profiles before returning traffic. The new code may have migrated the database, so a rollback must restore the matching pre-upgrade database instead of opening the migrated file with old code.

## Rollback after a failed upgrade

Stop the new web process and jobs. While the upgraded checkout still provides the restore script, restore the saved backup to a **new** directory. The command verifies checksums, SQLite integrity, media, and the matching billing key, and refuses to overwrite a target. Set the application's database and media paths to that restored directory. Load the saved billing key into the secret manager; keep the original `BETTER_AUTH_SECRET`. Then deploy the recorded old commit or release artifact with its own lockfile, build it, and start it against the restored files.

```sh
BACKUP_DIR=/secure/location/pre-upgrade-backup
RESTORE_DIR=/secure/location/rollback-restore
: "${OLD_RELEASE:?Set OLD_RELEASE to the recorded prior commit}"
npm run ops:restore -- --backup "$BACKUP_DIR" --target "$RESTORE_DIR"
export DATABASE_URL="file:$RESTORE_DIR/database.db"
export MEDIA_DIR="$RESTORE_DIR/media"
export BILLING_ENCRYPTION_KEY="$(< "$RESTORE_DIR/billing.key")"
git switch --detach "$OLD_RELEASE"
npm ci
npm run build
npm run start
```

Set `OLD_RELEASE` to the recorded prior commit before this block. A deployment that uses artifacts instead of Git should redeploy the recorded artifact in place of `git switch`. Keep the failed upgrade's database and media separate for investigation. Do not run the new migration against the restored copy, and do not assume a schema migration can be reversed without the matching backup. Once the old app is running, verify approved content, uploaded media, staff sign-in, and billing settings before returning traffic.
