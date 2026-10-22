import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { EXPECTED_TEST_COMMAND, tapRunPassed,
  testCommandRunsAllTests } from './tap-results.mjs';

let passed = false;
try {
  const files = readdirSync('tests').filter((name) => name.endsWith('.test.mjs'));
  if (files.length === 0) throw new Error('No Node test files were found');

  const packageFile = JSON.parse(readFileSync('package.json', 'utf8'));
  const command = packageFile.scripts?.test ?? '';
  if (!testCommandRunsAllTests(command)) {
    throw new Error(`npm test must equal: ${EXPECTED_TEST_COMMAND}`);
  }
  if (!readFileSync('README.md', 'utf8').includes('npm test')) {
    throw new Error('README does not document the repository test command');
  }

  const result = spawnSync('npm', ['test'], {
    encoding: 'utf8', timeout: 2_700_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: 'invalid:test-suite-must-install-a-temporary-database' },
  });
  if (!tapRunPassed(result.status, result.stdout ?? '')) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const stopped = result.error?.code === 'ETIMEDOUT' ? 'stopped at the time limit, ' : '';
    throw new Error(`npm test failed (${stopped}status ${result.status}, signal ${result.signal}): ` +
      `${output.slice(-4000)}`);
  }
  passed = true;
} catch (error) {
  process.stderr.write(`FOUND-007: ${error.message}\n`);
} finally {
  process.stdout.write(`sudus: FOUND-007: ${passed ? 'pass' : 'fail'}\n`);
}
