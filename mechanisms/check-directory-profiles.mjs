import { spawnSync } from "node:child_process";
import { tapRunPassed, tapTestPassed } from "./tap-results.mjs";

const requirements = ["PRF-001", "PRF-002", "PRF-003", "PRF-004"];
for (const requirement of requirements) {
  const test = spawnSync("node", [
    "--import", "tsx", "--test", "--test-reporter=tap",
    "tests/directory-profiles.test.mjs",
  ], {
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, CI: "1", PROFILE_REQUIREMENT: requirement },
  });
  const output = `${test.stdout ?? ""}\n${test.stderr ?? ""}`;
  const passed = tapRunPassed(test.status, test.stdout ?? "") &&
    tapTestPassed(test.stdout ?? "", requirement);
  if (test.error) process.stderr.write(`${test.error.message}\n`);
  if (!passed) {
    const failures = output.split("\n").filter((line) =>
      /^not ok \d+ - PRF-/.test(line) || /^  error:/.test(line));
    process.stderr.write(`${failures.join("\n")}\n`);
  }
  process.stdout.write(`sudus: ${requirement}: ${passed ? "pass" : "fail"}\n`);
}
