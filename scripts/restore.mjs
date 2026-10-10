import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { contained, hashFile, inspectDatabase, parsePairs,
  readKey, regularFiles } from './ops-common.mjs';

async function main() {
  const { '--backup': backup, '--target': target } =
    parsePairs(process.argv.slice(2), ['--backup', '--target']);
  if (existsSync(target)) throw new Error('Restore target already exists');
  if (contained(target, backup) || contained(backup, target)) {
    throw new Error('Restore target overlaps backup');
  }
  const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !manifest.hashes ||
      typeof manifest.hashes !== 'object' || Array.isArray(manifest.hashes)) {
    throw new Error('Invalid backup manifest');
  }
  const files = ['database.db', 'billing.key',
    ...regularFiles(join(backup, 'media')).map((file) => relative(backup, file))];
  if (files.some((file) => !/^[a-f0-9]{64}$/.test(manifest.hashes[file]))) {
    throw new Error('Backup file list does not match manifest');
  }
  for (const file of files) {
    if (await hashFile(join(backup, file)) !== manifest.hashes[file]) {
      throw new Error('Backup checksum failed');
    }
  }
  const key = readKey(join(backup, 'billing.key'));
  inspectDatabase(join(backup, 'database.db'), join(backup, 'media'), key);
  mkdirSync(dirname(target), { recursive: true });
  const stage = mkdtempSync(join(dirname(target), '.directory-restore-'));
  try {
    cpSync(join(backup, 'database.db'), join(stage, 'database.db'), { force: false });
    cpSync(join(backup, 'media'), join(stage, 'media'), { recursive: true, force: false });
    cpSync(join(backup, 'billing.key'), join(stage, 'billing.key'), { force: false });
    chmodSync(join(stage, 'billing.key'), 0o600);
    inspectDatabase(join(stage, 'database.db'), join(stage, 'media'), key);
    if (existsSync(target)) throw new Error('Restore target already exists');
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
