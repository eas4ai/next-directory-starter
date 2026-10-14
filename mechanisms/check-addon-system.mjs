import { spawnSync } from "node:child_process";
import { tapRunPassed, tapTestPassed } from "./tap-results.mjs";

const requirements = ["ADD-001", "ADD-002", "ADD-003"];
const test = spawnSync("node", ["--import", "tsx", "--test", "--test-reporter=tap",
  "tests/addon-system.test.mjs"], {
  encoding: "utf8",
  timeout: 600_000,
  env: { ...process.env, CI: "1" },
});

const output = `${test.stdout ?? ""}\n${test.stderr ?? ""}`;
const completed = tapRunPassed(test.status, test.stdout ?? "");
if (test.error) process.stderr.write(`${test.error.message}\n`);
if (test.status !== 0) {
  const failures = output.split("\n").filter((line) =>
    /^not ok \d+ - ADD-/.test(line) || /^  error:/.test(line));
  process.stderr.write(`${failures.join("\n")}\n`);
}
for (const requirement of requirements) {
  const passed = completed && tapTestPassed(test.stdout ?? "", requirement);
  process.stdout.write(`sudus: ${requirement}: ${passed ? "pass" : "fail"}\n`);
}
