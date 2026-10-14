import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const repository = resolve(import.meta.dirname, "..");
const fixture = join(repository, "fixtures/addons/reference-addon");
const selectedRequirement = process.env.ADDON_REQUIREMENT;

function requirementTest(name, body) {
  if (!selectedRequirement || name.startsWith(selectedRequirement)) test(name, body);
}

function run(cwd, args, options = {}) {
  return spawnSync(process.execPath, ["scripts/addons.mjs", ...args], {
    cwd,
    encoding: "utf8",
    timeout: options.timeout ?? 180_000,
    env: { ...process.env, CI: "1", ...options.env },
  });
}

function npm(cwd, args, env = {}, timeout = 300_000) {
  return spawnSync("npm", args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env, CI: "1", ...env },
  });
}

function expectSuccess(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
}

function expectFailure(result, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function copyFixture(root, id = "reference-addon") {
  const destination = join(root, id);
  cpSync(fixture, destination, { recursive: true });
  if (id !== "reference-addon") {
    const manifestPath = join(destination, "directory-addon.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.id = id;
    manifest.name = `Reference ${id}`;
    manifest.themes = manifest.themes.map((theme) => ({ ...theme, id, name: `Theme ${id}` }));
    manifest.templates = manifest.templates.map((template) =>
      ({ ...template, id, name: `Template ${id}` }));
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const path of [join(destination, "src/theme.ts"), join(destination, "src/template.css")]) {
      writeFileSync(path, readFileSync(path, "utf8").replaceAll("reference-addon", id));
    }
  }
  return destination;
}

const ignoredRoots = new Set([
  ".git", ".next", ".runtime", ".claude", ".gstack", ".superpowers", "node_modules",
]);

function copyStarter(destination) {
  cpSync(repository, destination, {
    recursive: true,
    filter(source) {
      const path = relative(repository, source);
      if (!path) return true;
      return !ignoredRoots.has(path.split(sep)[0]);
    },
  });
  symlinkSync(join(repository, "node_modules"), join(destination, "node_modules"), "dir");
}

function treeSnapshot(root) {
  const result = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (ignoredRoots.has(path.split("/")[0])) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isSymbolicLink()) result.set(path, `link:${readlinkSync(absolute)}`);
      else result.set(path, sha256(readFileSync(absolute)));
    }
  }
  visit(root);
  return [...result.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function packageArchive(source, output) {
  const result = run(repository, ["pack", source, output]);
  expectSuccess(result, "pack add-on");
}

requirementTest("ADD-001 validates deterministic packages before workspace writes", () => {
  assert.ok(existsSync(join(repository, "scripts/addons.mjs")), "add-on CLI is missing");
  const temporary = mkdtempSync(join(tmpdir(), "directory-addon-contract-"));
  try {
    const first = join(temporary, "first.zip");
    const second = join(temporary, "second.zip");
    packageArchive(fixture, first);
    packageArchive(fixture, second);
    assert.deepEqual(readFileSync(first), readFileSync(second),
      "equal package sources must produce byte-identical archives");
    expectSuccess(run(repository, ["validate", first]), "validate reference archive");

    const incompatible = copyFixture(temporary, "incompatible-addon");
    const incompatibleManifest = join(incompatible, "directory-addon.json");
    const incompatibleValue = JSON.parse(readFileSync(incompatibleManifest, "utf8"));
    incompatibleValue.compatibility.starter = ">=99.0.0";
    writeFileSync(incompatibleManifest, `${JSON.stringify(incompatibleValue, null, 2)}\n`);
    const incompatibleArchive = join(temporary, "incompatible.zip");
    packageArchive(incompatible, incompatibleArchive);
    expectFailure(run(repository, ["validate", incompatibleArchive]),
      "incompatible starter range");

    const traversal = copyFixture(temporary, "traversal-addon");
    const traversalManifest = join(traversal, "directory-addon.json");
    const traversalValue = JSON.parse(readFileSync(traversalManifest, "utf8"));
    traversalValue.files.push("../outside.txt");
    writeFileSync(traversalManifest, `${JSON.stringify(traversalValue, null, 2)}\n`);
    expectFailure(run(repository, ["pack", traversal, join(temporary, "traversal.zip")]),
      "traversal source path");

    const linked = copyFixture(temporary, "linked-addon");
    const linkedManifest = join(linked, "directory-addon.json");
    const linkedValue = JSON.parse(readFileSync(linkedManifest, "utf8"));
    linkedValue.files.push("src/linked.ts");
    writeFileSync(linkedManifest, `${JSON.stringify(linkedValue, null, 2)}\n`);
    symlinkSync("theme.ts", join(linked, "src/linked.ts"));
    assert.ok(lstatSync(join(linked, "src/linked.ts")).isSymbolicLink());
    expectFailure(run(repository, ["pack", linked, join(temporary, "linked.zip")]),
      "linked payload");

    const corrupt = join(temporary, "corrupt.zip");
    const bytes = readFileSync(first);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(corrupt, bytes);
    expectFailure(run(repository, ["validate", corrupt]), "corrupt archive");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

requirementTest("ADD-002 installs and removes owned files transactionally through generated registries", () => {
  const temporary = mkdtempSync(join(tmpdir(), "directory-addon-install-"));
  try {
    const source = join(temporary, "starter");
    copyStarter(source);
    const baseline = treeSnapshot(source);
    const archive = join(temporary, "reference.zip");
    packageArchive(fixture, archive);

    const failed = run(source, ["install", archive], {
      env: { NODE_ENV: "test", DIRECTORY_ADDON_TEST_FAIL_AFTER: "1" },
    });
    expectFailure(failed, "injected installation failure");
    assert.deepEqual(treeSnapshot(source), baseline, "failed install left workspace changes");

    expectSuccess(run(source, ["install", archive]), "install reference archive");
    assert.ok(existsSync(join(source, "src/addons/reference-addon/theme.ts")));
    assert.ok(existsSync(join(source, "public/addons/reference-addon/reference-mark.svg")));
    const generated = readFileSync(join(source, "src/addons/generated.ts"), "utf8");
    assert.match(generated, /reference-addon/);
    assert.match(readFileSync(join(source, "src/addons/generated.css"), "utf8"),
      /reference-addon/);
    const lock = JSON.parse(readFileSync(join(source, ".directory-starter/addons.lock.json"), "utf8"));
    assert.equal(lock.addons[0].id, "reference-addon");
    assert.ok(lock.addons[0].files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));

    const installed = treeSnapshot(source);
    expectFailure(run(source, ["install", archive]), "duplicate add-on identity");
    assert.deepEqual(treeSnapshot(source), installed, "rejected duplicate changed the workspace");

    const themePath = join(source, "src/addons/reference-addon/theme.ts");
    const theme = readFileSync(themePath, "utf8");
    writeFileSync(themePath, `${theme}\n// local change\n`);
    expectFailure(run(source, ["remove", "reference-addon"]), "remove drifted file");
    assert.match(readFileSync(themePath, "utf8"), /local change/);
    writeFileSync(themePath, theme);
    expectSuccess(run(source, ["remove", "reference-addon"]), "remove reference add-on");
    assert.deepEqual(treeSnapshot(source), baseline, "clean removal did not restore starter source");

    const secondSource = copyFixture(temporary, "second-addon");
    const secondArchive = join(temporary, "second.zip");
    packageArchive(secondSource, secondArchive);
    const left = join(temporary, "left");
    const right = join(temporary, "right");
    copyStarter(left);
    copyStarter(right);
    expectSuccess(run(left, ["install", archive]), "install first on left");
    expectSuccess(run(left, ["install", secondArchive]), "install second on left");
    expectSuccess(run(right, ["install", secondArchive]), "install second on right");
    expectSuccess(run(right, ["install", archive]), "install first on right");
    for (const path of ["src/addons/generated.ts", "src/addons/generated.css"]) {
      assert.equal(readFileSync(join(left, path), "utf8"), readFileSync(join(right, path), "utf8"),
        `${path} depends on installation order`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

requirementTest("ADD-003 reference add-on completes a clean build seed and removal round trip", () => {
  const temporary = mkdtempSync(join(tmpdir(), "directory-addon-roundtrip-"));
  try {
    const source = join(temporary, "starter");
    copyStarter(source);
    const baseline = treeSnapshot(source);
    const archive = join(temporary, "reference.zip");
    packageArchive(fixture, archive);
    const databasePath = join(temporary, `catalog-${randomBytes(6).toString("hex")}.db`);
    const env = {
      DATABASE_URL: `file:${databasePath}`,
      DIRECTORY_EXPLICIT_MIGRATIONS: "1",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      SITE_URL: "http://127.0.0.1:3000",
    };

    assert.equal(existsSync(databasePath), false);
    expectSuccess(run(source, ["install", archive]), "install reference add-on");
    assert.equal(existsSync(databasePath), false, "installation opened the operator database");

    const build = npm(source, ["run", "build"], env, 420_000);
    expectSuccess(build, "build installed reference add-on");
    expectSuccess(npm(source, ["run", "db:migrate"], env), "migrate add-on seed database");
    expectSuccess(npm(source, ["run", "addon:seed", "--", "reference-addon"], env),
      "explicitly seed reference add-on");
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(database.prepare("SELECT name FROM listings WHERE slug = ?")
        .pluck().get("reference-tool"), "Reference Tool");
    } finally {
      database.close();
    }

    expectSuccess(run(source, ["remove", "reference-addon"]), "remove reference add-on");
    const afterRemoval = new Database(databasePath, { readonly: true });
    try {
      assert.equal(afterRemoval.prepare("SELECT COUNT(*) FROM listings WHERE slug = ?")
        .pluck().get("reference-tool"), 1, "removal deleted explicitly seeded data");
    } finally {
      afterRemoval.close();
    }
    assert.deepEqual(treeSnapshot(source), baseline,
      "tracked starter source differs after the reference round trip");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
