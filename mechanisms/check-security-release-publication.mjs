import { execFileSync } from 'node:child_process';

const version = '1.2.1';
const priorVersion = '1.2.0';
const minimumNext = [16, 4, 2];
const advisories = ['GHSA-2464-fhr4-w9xw', 'GHSA-673q-mjm6-r5xr', 'GHSA-p3m5-59mp-jv5r'];

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function atLeast(actual, minimum) {
  const parts = actual.split('.').map(Number);
  for (let index = 0; index < minimum.length; index++) {
    if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
  }
  return true;
}

let passed = false;
try {
  expect(run('git', ['cat-file', '-t', version]) === 'tag', `${version} is not an annotated tag`);
  const tagObject = run('git', ['rev-parse', version]);
  const tagCommit = run('git', ['rev-parse', `${version}^{commit}`]);
  const remoteTagObject = run('git', ['ls-remote', 'origin', `refs/tags/${version}`])
    .split(/\s+/)[0];
  expect(remoteTagObject === tagObject, `${version} annotated tag object differs on origin`);
  const remoteTag = run('git', ['ls-remote', 'origin', `refs/tags/${version}^{}`])
    .split(/\s+/)[0];
  expect(remoteTag === tagCommit, `${version} does not resolve to the same commit on origin`);
  execFileSync('git', ['merge-base', '--is-ancestor', tagCommit, 'origin/main'], { stdio: 'ignore' });

  const lock = JSON.parse(run('git', ['show', `${tagCommit}:package-lock.json`]));
  const nextVersion = lock.packages?.['node_modules/next']?.version ?? '';
  expect(atLeast(nextVersion, minimumNext), `${version} lockfile installs next ${nextVersion || 'unknown'}`);

  const release = JSON.parse(run('gh', [
    'release', 'view', version,
    '--json', 'body,isDraft,isPrerelease,tagName,url',
  ]));
  expect(release.tagName === version, 'GitHub release names a different tag');
  expect(!release.isDraft, 'GitHub release is still a draft');
  expect(!release.isPrerelease, 'GitHub release is marked as a prerelease');
  expect(release.url, 'GitHub release has no public URL');
  for (const note of [...advisories, 'Upgrade notes', priorVersion]) {
    expect(release.body.includes(note), `Release notes omit: ${note}`);
  }
  passed = true;
} catch (error) {
  process.stderr.write(`FOUND-009: ${error.message}\n`);
} finally {
  process.stdout.write(`sudus: FOUND-009: ${passed ? 'pass' : 'fail'}\n`);
}
