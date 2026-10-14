import { execFileSync } from 'node:child_process';

const version = '1.1.0';
const priorVersion = '1.0.0';

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

let passed = false;
try {
  expect(run('git', ['cat-file', '-t', version]) === 'tag', `${version} is not an annotated tag`);
  const tagCommit = run('git', ['rev-parse', `${version}^{commit}`]);
  const remoteTag = run('git', ['ls-remote', 'origin', `refs/tags/${version}^{}`])
    .split(/\s+/)[0];
  expect(remoteTag === tagCommit, `${version} does not resolve to the same commit on origin`);
  execFileSync('git', ['merge-base', '--is-ancestor', tagCommit, 'origin/main'], { stdio: 'ignore' });

  const release = JSON.parse(run('gh', [
    'release', 'view', version,
    '--json', 'body,isDraft,isPrerelease,tagName,url',
  ]));
  expect(release.tagName === version, 'GitHub release names a different tag');
  expect(!release.isDraft, 'GitHub release is still a draft');
  expect(!release.isPrerelease, 'GitHub release is marked as a prerelease');
  expect(release.url, 'GitHub release has no public URL');

  const requiredNotes = [
    'Security and access control',
    'Payments and recovery',
    'Agent workflows',
    'Media, SEO, and publishing',
    'Operations and documentation',
    'Upgrade notes',
    priorVersion,
  ];
  for (const note of requiredNotes) {
    expect(release.body.includes(note), `Release notes omit: ${note}`);
  }
  passed = true;
} catch (error) {
  process.stderr.write(`FOUND-008: ${error.message}\n`);
} finally {
  process.stdout.write(`sudus: FOUND-008: ${passed ? 'pass' : 'fail'}\n`);
}
