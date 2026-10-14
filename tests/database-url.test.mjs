import assert from "node:assert/strict";
import test from "node:test";
import { parseDatabaseUrl } from "../src/lib/database-url.mjs";

test("database URLs select an unambiguous SQLite file", () => {
  assert.equal(parseDatabaseUrl("file:./data/directory.db"), "./data/directory.db");
  assert.equal(parseDatabaseUrl("file:/var/lib/directory.db"), "/var/lib/directory.db");
});

test("database URLs reject missing and ambiguous file paths", () => {
  for (const url of [undefined, "sqlite:directory.db", "file:",
    "file:./data/directory.db?mode=ro", "file:./data/directory.db#snapshot",
    "file:./data/directory.db\0other"]) {
    assert.throws(() => parseDatabaseUrl(url), /DATABASE_URL/);
  }
});

test("in-memory databases require an explicit test-only allowance", () => {
  assert.throws(() => parseDatabaseUrl("file::memory:"), /persistent/);
  assert.equal(parseDatabaseUrl("file::memory:", { allowMemory: true }), ":memory:");
});
