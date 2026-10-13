import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

let passed = false;
try {
  const files = readdirSync('tests').filter((name) => name.endsWith('.test.mjs'));
  if (files.length === 0) throw new Error('No Node test files were found');

  const packageFile = JSON.parse(readFileSync('package.json', 'utf8'));
  const command = packageFile.scripts?.test ?? '';
  if (!command.includes('tests/*.test.mjs') || !command.includes('--test-concurrency=1')) {
    throw new Error('npm test must run every Node test file without concurrent builds');
  }
  if (!readFileSync('README.md', 'utf8').includes('npm test')) {
    throw new Error('README does not document the repository test command');
  }

  const result = spawnSync('npm', ['test'], {
    encoding: 'utf8', timeout: 900_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: 'invalid:test-suite-must-install-a-temporary-database' },
  });
  if (result.status !== 0 || !/^# fail 0$/m.test(result.stdout)) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    throw new Error(`npm test failed: ${output.slice(-4000) || result.error?.message}`);
  }
  passed = true;
} catch (error) {
  process.stderr.write(`FOUND-007: ${error.message}\n`);
} finally {
  process.stdout.write(`sudus: FOUND-007: ${passed ? 'pass' : 'fail'}\n`);
}
