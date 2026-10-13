import { spawnSync } from 'node:child_process';

const requirements = ['THM-001', 'THM-002', 'THM-003', 'THM-004'];
const test = spawnSync('node', ['--import', 'tsx', '--test', '--test-reporter=tap',
  'tests/theme-sdk.test.mjs'], {
  encoding: 'utf8', timeout: 240_000,
  env: { ...process.env, CI: '1' },
});

const output = `${test.stdout ?? ''}\n${test.stderr ?? ''}`;
if (test.error) process.stderr.write(`${test.error.message}\n`);
if (test.status !== 0) {
  const failures = output.split('\n').filter((line) =>
    /^not ok \d+ - THM-/.test(line) || /^  error:/.test(line));
  process.stderr.write(`${failures.join('\n')}\n`);
}
for (const requirement of requirements) {
  const escaped = requirement.replace('-', '\\-');
  const passed = new RegExp(`^ok \\d+ - ${escaped}\\b`, 'm').test(output) &&
    !new RegExp(`^not ok \\d+ - ${escaped}\\b`, 'm').test(output);
  process.stdout.write(`sudus: ${requirement}: ${passed ? 'pass' : 'fail'}\n`);
}
