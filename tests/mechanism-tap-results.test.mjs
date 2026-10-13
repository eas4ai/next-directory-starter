import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPECTED_TEST_COMMAND,
  tapRunPassed,
  tapTestPassed,
  testCommandRunsAllTests,
} from '../mechanisms/tap-results.mjs';

const summary = ({ tests = 2, pass = 2, fail = 0, cancelled = 0, skipped = 0,
  todo = 0 } = {}) => `TAP version 13
ok 1 - THM-001 renders tokens
ok 2 - THM-002 persists selection
1..${tests}
# tests ${tests}
# pass ${pass}
# fail ${fail}
# cancelled ${cancelled}
# skipped ${skipped}
# todo ${todo}
`;

test('mechanism TAP results require executed passing tests and no incomplete outcomes', () => {
  assert.equal(tapRunPassed(0, summary()), true);
  assert.equal(tapRunPassed(1, summary()), false);
  assert.equal(tapRunPassed(0, summary({ tests: 0, pass: 0 })), false);
  assert.equal(tapRunPassed(0, summary({ tests: 2, pass: 0, skipped: 2 })), false);
  assert.equal(tapRunPassed(0, summary({ pass: 1, fail: 1 })), false);
  assert.equal(tapRunPassed(0, summary({ pass: 1, cancelled: 1 })), false);
  assert.equal(tapRunPassed(0, summary({ pass: 1, todo: 1 })), false);
  assert.equal(tapRunPassed(0, 'ok 1 - THM-001 renders tokens\n'), false);
});

test('mechanism TAP results reject skipped or failed named tests', () => {
  assert.equal(tapTestPassed(summary(), 'THM-001'), true);
  assert.equal(tapTestPassed('ok 1 - THM-001 renders tokens # SKIP later\n', 'THM-001'), false);
  assert.equal(tapTestPassed('not ok 1 - THM-001 renders tokens\n', 'THM-001'), false);
  assert.equal(tapTestPassed('ok 1 - THM-0010 renders tokens\n', 'THM-001'), false);
});

test('FOUND-007 accepts only the repository command that executes the complete serial suite', () => {
  assert.equal(testCommandRunsAllTests(EXPECTED_TEST_COMMAND), true);
  assert.equal(testCommandRunsAllTests(
    'echo "tests/*.test.mjs --test-concurrency=1" && node --test tests/page-metadata.test.mjs'),
  false);
  assert.equal(testCommandRunsAllTests(
    'node --import tsx --test --test-reporter=tap tests/*.test.mjs'), false);
});
