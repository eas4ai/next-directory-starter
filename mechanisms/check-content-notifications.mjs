import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tapRunPassed } from './tap-results.mjs';

const cases = [
  ['MED-001', 'tests/private-media.test.mjs'],
  ['MED-002', 'tests/media-visibility.test.mjs'],
  ['EDIT-004', 'tests/editorial-markdown-revisions.test.mjs'],
  ['EDIT-005', 'tests/editorial-discovery.test.mjs'],
  ['NOTIFY-001', 'tests/notifications-state.test.mjs'],
  ['NOTIFY-002', 'tests/notifications-delivery.test.mjs'],
];

for (const [requirement, file] of cases) {
  let passed = false;
  if (!existsSync(file)) {
    process.stderr.write(`${requirement}: ${file} is absent.\n`);
  } else {
    const result = spawnSync(process.execPath,
      ['--import', 'tsx', '--test', '--test-reporter=tap', file], {
      encoding: 'utf8', timeout: 90_000,
    });
    passed = tapRunPassed(result.status, result.stdout ?? '');
    if (!passed) {
      process.stderr.write(`${requirement}: ${file} failed: ${
        (result.stdout ?? '').slice(-900)} ${(result.stderr ?? '').slice(-400)}\n`);
    }
  }
  process.stdout.write(`sudus: ${requirement}: ${passed ? 'pass' : 'fail'}\n`);
}
