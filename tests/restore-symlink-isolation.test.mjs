import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

function checksum(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'restore-symlink-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const live = join(root, 'live');
  const media = join(live, 'media');
  const database = join(live, 'database.db');
  mkdirSync(media, { recursive: true });
  writeFileSync(join(media, 'evidence.txt'), 'live media');
  const db = new Database(database);
  db.exec("CREATE TABLE evidence (value TEXT NOT NULL); INSERT INTO evidence VALUES ('live')");
  db.close();
  return { root, media, database, key: randomBytes(32).toString('base64url') };
}

function restore({ backup, target, database, media, key }) {
  return spawnSync(process.execPath,
    ['scripts/restore.mjs', '--backup', backup, '--target', target], {
      env: {
        ...process.env,
        DATABASE_URL: `file:${database}`,
        MEDIA_DIR: media,
        BILLING_ENCRYPTION_KEY: key,
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
}

function writeManifest(backup, files) {
  writeFileSync(join(backup, 'manifest.json'), `${JSON.stringify({
    version: 1,
    hashes: Object.fromEntries(files.map((file) => [file, checksum(join(backup, file))])),
  }, null, 2)}\n`);
}

test('restore rejects a database symlink before creating the target', (t) => {
  const live = fixture(t);
  const backup = join(live.root, 'database-link-backup');
  const target = join(live.root, 'database-link-restore');
  mkdirSync(join(backup, 'media'), { recursive: true });
  symlinkSync(live.database, join(backup, 'database.db'));
  writeFileSync(join(backup, 'billing.key'), live.key, { mode: 0o600 });
  writeManifest(backup, ['database.db', 'billing.key']);

  const result = restore({ backup, target, ...live });

  assert.notEqual(result.status, 0, 'restore accepted a database symlink');
  assert.equal(existsSync(target), false);
});

test('restore rejects a media-root symlink before creating the target', (t) => {
  const live = fixture(t);
  const backup = join(live.root, 'media-link-backup');
  const target = join(live.root, 'media-link-restore');
  mkdirSync(backup, { recursive: true });
  const db = new Database(join(backup, 'database.db'));
  db.exec("CREATE TABLE evidence (value TEXT NOT NULL); INSERT INTO evidence VALUES ('backup')");
  db.close();
  writeFileSync(join(backup, 'billing.key'), live.key, { mode: 0o600 });
  symlinkSync(live.media, join(backup, 'media'), 'dir');
  writeManifest(backup, ['database.db', 'billing.key', 'media/evidence.txt']);

  const result = restore({ backup, target, ...live });

  assert.notEqual(result.status, 0, 'restore accepted a media-root symlink');
  assert.equal(existsSync(target), false);
});
