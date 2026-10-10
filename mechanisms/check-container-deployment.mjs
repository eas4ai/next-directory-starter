import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const scratch = mkdtempSync(join(tmpdir(), 'directory-container-check-'));
const suffix = randomBytes(4).toString('hex');
const project = `directory-check-${suffix}`;
const image = `${project}:test`;
const fixtureKey = randomBytes(32).toString('base64url');
const envFile = join(scratch, 'container.env');
let passed = false;
let built = false;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, timeout = 180_000) {
  const env = { ...process.env };
  for (const key of ['SITE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'DATABASE_URL',
    'MEDIA_DIR', 'DIRECTORY_PORT', 'DIRECTORY_ENV_FILE', 'DIRECTORY_IMAGE']) delete env[key];
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout,
    maxBuffer: 4 * 1024 * 1024 });
  expect(result.status === 0, `${command} ${args.slice(-4).join(' ')} failed: ${
    (result.stderr || result.stdout || result.error?.message || '').slice(-1800)}`);
  return result.stdout;
}

function compose(args, timeout) {
  return run('docker', ['compose', '-p', project, '--env-file', envFile, '-f', 'compose.yaml',
    ...args], timeout);
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function publicDirectory(port) {
  const url = `http://127.0.0.1:${port}/listings`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.status === 200 && (await response.text()).includes('Example Tool')) return;
    } catch { /* app is starting */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('Container did not serve the seeded public directory');
}

try {
  for (const file of ['Dockerfile', 'compose.yaml', '.dockerignore', '.env.docker.example']) {
    expect(existsSync(join(root, file)), `${file} is missing`);
  }
  const ignored = readFileSync(join(root, '.dockerignore'), 'utf8');
  expect(ignored.includes('.env') && ignored.includes('.runtime') && ignored.includes('node_modules'),
    'Build context does not exclude secrets, runtime data, and local dependencies');
  const manual = readFileSync(join(root, 'docs/operator-manual.md'), 'utf8');
  expect(manual.includes('docker compose') && manual.includes('db:migrate') &&
    manual.includes('ops:backup') && manual.includes('ops:restore'),
  'Operator manual is missing container migration or recovery commands');

  const port = await freePort();
  writeFileSync(envFile, [
    `DIRECTORY_ENV_FILE=${envFile}`, `DIRECTORY_IMAGE=${image}`, `DIRECTORY_PORT=${port}`,
    `SITE_URL=http://127.0.0.1:${port}`, `BETTER_AUTH_URL=http://127.0.0.1:${port}`,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64url')}`,
    `BILLING_ENCRYPTION_KEY=${fixtureKey}`, '',
  ].join('\n'), { mode: 0o600 });
  compose(['config', '-q']);
  compose(['build', '--quiet'], 600_000);
  built = true;

  const imageEnv = run('docker', ['image', 'inspect', '--format', '{{json .Config.Env}}', image]);
  expect(!imageEnv.includes(fixtureKey), 'Deployment secret entered image configuration');
  const imageCheck = run('docker', ['run', '--rm', '--entrypoint', 'node', image, '-e',
    'const fs=require("node:fs");console.log(JSON.stringify({uid:process.getuid(),secret:fs.existsSync("/app/.env.docker"),database:fs.existsSync("/app/data/directory.db")}))']);
  const inspected = JSON.parse(imageCheck.trim());
  expect(inspected.uid !== 0 && !inspected.secret && !inspected.database,
    'Image runs as root or contains a secret or operator database');

  expect(compose(['run', '--rm', '--no-deps', 'web', 'npm', 'run', 'db:migrate'], 180_000)
    .includes('Catalog migration complete.'), 'Container migration did not finish');
  expect(compose(['run', '--rm', '--no-deps', 'web', 'npm', 'run', 'db:seed'], 120_000)
    .includes('Sample catalog seeded.'), 'Container seed did not finish');
  compose(['up', '-d', '--no-build']);
  await publicDirectory(port);
  const mediaPath = '/app/data/media/container-persistence-check';
  compose(['exec', '-T', 'web', 'node', '-e',
    `const fs=require('node:fs');fs.mkdirSync('/app/data/media',{recursive:true});fs.writeFileSync('${mediaPath}','kept')`]);
  compose(['up', '-d', '--force-recreate', '--no-build']);
  await publicDirectory(port);
  expect(compose(['exec', '-T', 'web', 'node', '-e',
    `process.stdout.write(require('node:fs').readFileSync('${mediaPath}','utf8'))`]).trim() === 'kept',
  'Uploaded media directory did not survive container replacement');
  expect(compose(['run', '--rm', '--no-deps', 'web', 'npm', 'run', 'notifications:deliver', '--',
    '--limit', '1']).includes('Notifications attempted:'), 'Notification command missed container data');
  compose(['run', '--rm', '--no-deps', 'web', 'npm', 'run', 'billing:reconcile', '--', '--limit', '1']);

  const backupDir = join(scratch, 'backup-output');
  const keyFile = join(scratch, 'billing.key');
  mkdirSync(backupDir, { mode: 0o777 });
  writeFileSync(keyFile, `${fixtureKey}\n`, { mode: 0o644 });
  expect(compose(['run', '--rm', '--no-deps', '-v', `${backupDir}:/backup`,
    '-v', `${keyFile}:/run/secrets/billing.key:ro`, 'web', 'npm', 'run', 'ops:backup', '--',
    '--output', '/backup/check', '--key-file', '/run/secrets/billing.key'])
    .includes('Backup created and verified.'), 'Container backup did not verify');
  expect(compose(['run', '--rm', '--no-deps', '-v', `${backupDir}:/backup`, 'web',
    'npm', 'run', 'ops:restore', '--', '--backup', '/backup/check', '--target', '/backup/restored'])
    .includes('Isolated restore verified.'), 'Container restore did not verify');
  passed = true;
} catch (error) {
  process.stderr.write(`OPS-003: ${error.message}\n`);
} finally {
  try { compose(['down', '-v', '--remove-orphans'], 60_000); } catch { /* best effort cleanup */ }
  if (built) {
    try { run('docker', ['image', 'rm', '-f', image], 60_000); } catch { /* best effort cleanup */ }
  }
  rmSync(scratch, { recursive: true, force: true });
  process.stdout.write(`sudus: OPS-003: ${passed ? 'pass' : 'fail'}\n`);
}
