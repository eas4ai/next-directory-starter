import './load-env.mjs';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { canonicalPath, contained, databasePath, hashFile, inspectDatabase,
  mediaPath, parsePairs, pathEntryExists, readKey, regularFiles,
  requireRegularFile } from './ops-common.mjs';

async function main() {
  const { '--backup': backup, '--target': target } =
    parsePairs(process.argv.slice(2), ['--backup', '--target']);
  if (pathEntryExists(target)) throw new Error('Restore target already exists');
  const plannedTarget = canonicalPath(target);
  const archived = canonicalPath(backup);
  const liveDatabase = canonicalPath(databasePath());
  const liveMedia = canonicalPath(mediaPath());
  if (contained(plannedTarget, archived) || contained(archived, plannedTarget) ||
      contained(plannedTarget, liveMedia) || contained(liveMedia, plannedTarget) ||
      contained(liveDatabase, plannedTarget) || contained(plannedTarget, liveDatabase)) {
    throw new Error('Restore target overlaps backup or live storage');
  }
  const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !manifest.hashes ||
      typeof manifest.hashes !== 'object' || Array.isArray(manifest.hashes)) {
    throw new Error('Invalid backup manifest');
  }
  const backupDatabase = join(backup, 'database.db');
  const backupKey = join(backup, 'billing.key');
  const backupMedia = join(backup, 'media');
  requireRegularFile(backupDatabase, 'Backup database');
  requireRegularFile(backupKey, 'Backup billing key');
  const files = ['database.db', 'billing.key',
    ...regularFiles(backupMedia).map((file) => relative(backup, file))];
  if (files.length !== Object.keys(manifest.hashes).length ||
      files.some((file) => !/^[a-f0-9]{64}$/.test(manifest.hashes[file]))) {
    throw new Error('Backup file list does not match manifest');
  }
  for (const file of files) {
    if (await hashFile(join(backup, file)) !== manifest.hashes[file]) {
      throw new Error('Backup checksum failed');
    }
  }
  const key = readKey(backupKey);
  inspectDatabase(backupDatabase, backupMedia, key);
  mkdirSync(dirname(target), { recursive: true });
  if (canonicalPath(target) !== plannedTarget) throw new Error('Restore path changed');
  const stage = mkdtempSync(join(dirname(target), '.directory-restore-'));
  try {
    const stagedDatabase = join(stage, 'database.db');
    const stagedMedia = join(stage, 'media');
    const stagedKeyFile = join(stage, 'billing.key');
    cpSync(backupDatabase, stagedDatabase, { force: false });
    cpSync(backupMedia, stagedMedia, { recursive: true, force: false });
    cpSync(backupKey, stagedKeyFile, { force: false });
    chmodSync(stagedKeyFile, 0o600);
    requireRegularFile(stagedDatabase, 'Restored database');
    regularFiles(stagedMedia);
    const stagedKey = readKey(stagedKeyFile);
    if (stagedKey !== key) throw new Error('Restored billing key changed during copy');
    inspectDatabase(stagedDatabase, stagedMedia, stagedKey);
    if (pathEntryExists(target) || canonicalPath(target) !== plannedTarget) {
      throw new Error('Restore target changed or already exists');
    }
    renameSync(stage, target);
    process.stdout.write('Isolated restore verified. Point a stopped installation at the new files.\n');
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Restore failed'}\n`);
  process.exitCode = 1;
});
