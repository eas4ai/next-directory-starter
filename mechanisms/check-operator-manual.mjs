import { existsSync, readFileSync } from 'node:fs';

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function source(path, token) {
  expect(existsSync(path), `Source path missing: ${path}`);
  expect(readFileSync(path, 'utf8').includes(token), `Source behavior missing: ${path} ${token}`);
}

const chapters = [
  'Install and open a local directory',
  'Set site identity and appearance',
  'Build the catalog',
  'Manage accounts, owner submissions, and review',
  'Publish articles, terms, and images',
  'Configure search and sharing',
  'Import observed links with an agent',
  'Set plans and payment providers',
  'Deliver owner notices',
  'Deploy, back up, restore, and upgrade',
];

let passed = false;
try {
  expect(existsSync('docs/operator-manual.md'), 'Operator manual is missing');
  const manual = readFileSync('docs/operator-manual.md', 'utf8');
  const readme = readFileSync('README.md', 'utf8');
  expect(readme.includes('](docs/operator-manual.md)') &&
    !readme.includes('operator manual will cover'), 'README does not link the finished manual');

  const headings = [...manual.matchAll(/^## \d+\. (.+)$/gm)].map((match) => match[1]);
  expect(JSON.stringify(headings) === JSON.stringify(chapters),
    'Manual chapters do not cover the operator workflows');
  const sourceLinks = [...manual.matchAll(/\]\(\.\.\/((?:src|scripts)\/[^)]+)\)/g)]
    .map((match) => match[1]);
  expect(new Set(sourceLinks).size >= 60, 'Manual needs broad implementation evidence');
  for (const path of sourceLinks) expect(existsSync(path), `Broken implementation link: ${path}`);
  for (const chapter of chapters) {
    const part = manual.split(`## ${chapters.indexOf(chapter) + 1}. ${chapter}`)[1]?.split('\n## ')[0] ?? '';
    expect(part.includes('](../src/') || part.includes('](../scripts/'),
      `Manual chapter has no implementation evidence: ${chapter}`);
  }

  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  const commands = [...manual.matchAll(/npm run ([a-z][a-z:-]*)/g)].map((match) => match[1]);
  expect(commands.length >= 10, 'Manual needs executable setup and maintenance commands');
  for (const name of commands) expect(name in scripts, `Unknown npm script: ${name}`);
  for (const name of ['db:migrate', 'db:seed', 'account:provision', 'dev',
    'build', 'start', 'billing:reconcile', 'notifications:deliver', 'ops:backup', 'ops:restore']) {
    expect(commands.includes(name), `Manual omits npm run ${name}`);
  }

  source('src/lib/database.ts', 'process.env.DATABASE_URL');
  source('src/lib/media.ts', 'promoteDraftMedia');
  source('src/app/admin/import/import-workspace.tsx', 'context.registerTool');
  source('src/lib/billing-profiles.ts', 'nowpayments');
  source('src/lib/notification-delivery.ts', 'MAX_ATTEMPTS');
  source('scripts/backup.mjs', 'inspectDatabase');
  source('scripts/restore.mjs', 'Backup checksum failed');
  expect(manual.includes('export DATABASE_URL') && manual.includes('.env.local') &&
    manual.includes('tsx'), 'Manual omits custom database CLI environment workaround');
  expect(manual.includes('WebMCP') && manual.includes('/api/mcp'),
    'Manual omits an agent access path');
  expect(manual.includes('NOWPayments') && manual.includes('HTTPS') &&
    manual.includes('one-time'), 'Manual omits payment provider limits');
  expect(manual.includes('client_max_body_size 8m;') && manual.includes('7,100,000 bytes') &&
    manual.includes('413 Request Entity Too Large'),
    'Manual omits a verified reverse-proxy request-body limit');
  expect(manual.includes('proxy_set_header X-Real-IP $remote_addr;') &&
    manual.includes('proxy_set_header X-Forwarded-For $remote_addr;') &&
    !manual.includes('$proxy_add_x_forwarded_for'),
    'Manual does not overwrite caller-controlled forwarding headers');
  expect(manual.includes('BILLING_ENCRYPTION_KEY') && manual.includes('Isolated restore verified.') &&
    manual.includes('Backup created and verified.'), 'Manual omits backup recovery boundaries');
  passed = true;
} catch (error) {
  process.stderr.write(`DOC-002: ${error.message}\n`);
} finally {
  process.stdout.write(`sudus: DOC-002: ${passed ? 'pass' : 'fail'}\n`);
}
