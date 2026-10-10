import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync,
  writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { contained, databasePath, hashFile, inspectDatabase, mediaPath,
  parsePairs, readKey, regularFiles } from './ops-common.mjs';

async function main() {
  const { '--output': output, '--key-file': keyFile } =
    parsePairs(process.argv.slice(2), ['--output', '--key-file']);
  const source = databasePath();
  const media = mediaPath(source);
  if (!existsSync(source)) throw new Error('Source database does not exist');
  if (existsSync(output)) throw new Error('Backup destination already exists');
  if (contained(output, media) || contained(source, output) ||
      contained(media, output) || contained(keyFile, output)) {
    throw new Error('Backup destination overlaps live storage');
  }
  const key = readKey(keyFile);
  if (key !== process.env.BILLING_ENCRYPTION_KEY) {
    throw new Error('Key file does not match BILLING_ENCRYPTION_KEY');
  }
  mkdirSync(dirname(output), { recursive: true });
  const stage = mkdtempSync(join(dirname(output), '.directory-backup-'));
  try {
    mkdirSync(join(stage, 'media'));
    const opened = new Database(source, { readonly: true, fileMustExist: true });
    try { await opened.backup(join(stage, 'database.db')); }
    finally { opened.close(); }
    if (existsSync(media)) cpSync(media, join(stage, 'media'), { recursive: true, force: false });
    writeFileSync(join(stage, 'billing.key'), key, { mode: 0o600, flag: 'wx' });
    inspectDatabase(join(stage, 'database.db'), join(stage, 'media'), key);
    const files = ['database.db', 'billing.key',
      ...regularFiles(join(stage, 'media')).map((file) => relative(stage, file))];
    const hashes = Object.fromEntries(await Promise.all(files.map(async (file) =>
      [file, await hashFile(join(stage, file))])));
    writeFileSync(join(stage, 'manifest.json'),
      `${JSON.stringify({ version: 1, hashes }, null, 2)}\n`, { flag: 'wx' });
    if (existsSync(output)) throw new Error('Backup destination already exists');
    renameSync(stage, output);
    process.stdout.write('Backup created and verified. Keep the directory private.\n');
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Backup failed'}\n`);
  process.exitCode = 1;
});
