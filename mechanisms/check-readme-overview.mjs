import { existsSync, readFileSync } from 'node:fs';

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const source = (path, token) => {
  expect(existsSync(path), `Source path missing: ${path}`);
  expect(readFileSync(path, 'utf8').includes(token), `Source behavior missing: ${path} ${token}`);
};

const sections = [
  ['Public discovery', 'src/lib/listings.ts', 'searchPublishedListings'],
  ['Owner submissions', 'src/lib/moderation.ts', 'submitOwnerListing'],
  ['Editorial publishing', 'src/lib/articles.ts', 'publishArticleRevision'],
  ['Identity and staff access', 'src/lib/auth.ts', 'requireEmailVerification'],
  ['Branding and themes', 'src/lib/theme-selection.ts', 'templateOptions'],
  ['Search and sharing', 'src/lib/page-metadata.ts', 'pageMetadata'],
  ['Agent-assisted imports', 'src/app/api/mcp/route.ts', 'stage_links'],
  ['Optional billing', 'src/lib/plans.ts', 'billingMode'],
  ['Operations', 'scripts/backup.mjs', 'inspectDatabase'],
];

let passed = false;
try {
  const readme = readFileSync('README.md', 'utf8');
  expect(readme.includes('## What you can build'),
    'README lacks a source-grounded What you can build section');
  expect(readme.includes('## Features'), 'README lacks a feature overview');
  for (const [heading, path, token] of sections) {
    source(path, token);
    expect(readme.includes(`### ${heading}`), `README omits ${heading}`);
    expect(readme.includes(`](${path})`), `README lacks a source link for ${heading}`);
  }
  source('src/lib/listings.ts', 'name: string;');
  source('src/lib/listings.ts', 'category: string;');
  source('src/lib/listings.ts', 'url: string;');
  const ideas = readme.split('## What you can build')[1]?.split('\n## ')[0] ?? '';
  expect((ideas.match(/^\|[^\n]+\|$/gm) ?? []).length >= 6 &&
    /name/i.test(ideas) && /category/i.test(ideas) && /URL/.test(ideas),
  'Site ideas lack several examples grounded in the listing fields');
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  for (const script of ['db:migrate', 'db:seed', 'account:provision', 'dev', 'build', 'start']) {
    expect(scripts[script] && readme.includes(`npm run ${script}`),
      `README quick start or package script missing: ${script}`);
  }
  const brief = readFileSync('docs/manual-brief.md', 'utf8');
  expect(brief.includes('# Operator manual brief') &&
    brief.includes('Verify against source') && brief.includes('## Chapters'),
  'Manual brief lacks source-verification scope');
  const paths = [...brief.matchAll(/\]\((src\/[^)]+|scripts\/[^)]+)\)/g)].map((match) => match[1]);
  expect(new Set(paths).size >= 12 && paths.every((path) => existsSync(path)),
    'Manual brief needs at least 12 valid implementation links');
  passed = true;
} catch (error) {
  process.stderr.write(`DOC-001: ${error.message}\n`);
} finally {
  process.stdout.write(`sudus: DOC-001: ${passed ? 'pass' : 'fail'}\n`);
}
