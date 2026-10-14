export const EXPECTED_TEST_COMMAND =
  'node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs';

function total(output, name) {
  const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
  return matches.length === 1 ? Number(matches[0][1]) : null;
}

export function tapRunPassed(status, output) {
  if (status !== 0) return false;
  const totals = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']
    .map((name) => [name, total(output, name)]));
  return Object.values(totals).every((value) => value !== null) &&
    totals.tests > 0 && totals.pass > 0 && totals.tests === totals.pass &&
    totals.fail === 0 && totals.cancelled === 0 && totals.skipped === 0 && totals.todo === 0;
}

export function tapTestPassed(output, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = output.match(new RegExp(`^ok \\d+ - ${escaped}\\b.*$`, 'gm')) ?? [];
  return lines.length === 1 && !/# (?:SKIP|TODO)\b/i.test(lines[0]);
}

export function testCommandRunsAllTests(command) {
  return command.trim() === EXPECTED_TEST_COMMAND;
}
