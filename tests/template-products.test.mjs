import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repository = resolve(import.meta.dirname, "..");
const selectedRequirement = process.env.TEMPLATE_REQUIREMENT;

function requirementTest(name, body) {
  if (!selectedRequirement || name.startsWith(selectedRequirement)) test(name, body);
}

requirementTest("TPL-001 installs constrained public-template renderer modules", () => {
  const temporary = mkdtempSync(join(tmpdir(), "directory-template-sdk-"));
  const run = (cwd, args) => spawnSync(process.execPath, ["scripts/addons.mjs", ...args], {
    cwd, encoding: "utf8", timeout: 300_000, env: { ...process.env, CI: "1" },
  });
  const expectSuccess = (result, label) => assert.equal(result.status, 0,
    `${label}: ${result.stderr || result.stdout}`);
  try {
    const rendererFixture = join(repository, "fixtures/addons/renderer-addon");
    const referenceFixture = join(repository, "fixtures/addons/reference-addon");
    const rendererArchive = join(temporary, "renderer.zip");
    const referenceArchive = join(temporary, "reference.zip");
    expectSuccess(run(repository, ["pack", referenceFixture, referenceArchive]),
      "pack stylesheet-only add-on");
    expectSuccess(run(repository, ["validate", referenceArchive]),
      "validate stylesheet-only add-on");
    expectSuccess(run(repository, ["pack", rendererFixture, rendererArchive]),
      "pack renderer add-on");
    expectSuccess(run(repository, ["validate", rendererArchive]), "validate renderer add-on");

    const forbidden = join(temporary, "forbidden");
    cpSync(rendererFixture, forbidden, { recursive: true });
    const forbiddenModule = join(forbidden, "src/template.tsx");
    writeFileSync(forbiddenModule, readFileSync(forbiddenModule, "utf8")
      .replace('import { TemplateLink } from "@/components/public-template-primitives";',
        'import { database } from "@/lib/database";'));
    const rejected = run(repository, ["pack", forbidden, join(temporary, "forbidden.zip")]);
    assert.notEqual(rejected.status, 0, "forbidden renderer import unexpectedly packed");
    assert.match(rejected.stderr, /renderer import/i);

    const mismatched = join(temporary, "mismatched");
    cpSync(rendererFixture, mismatched, { recursive: true });
    const mismatchedModule = join(mismatched, "src/template.tsx");
    writeFileSync(mismatchedModule, readFileSync(mismatchedModule, "utf8")
      .replace('id: "renderer-addon"', 'id: "other-renderer"'));
    const mismatchResult = run(repository,
      ["pack", mismatched, join(temporary, "mismatched.zip")]);
    assert.notEqual(mismatchResult.status, 0, "identity-mismatched renderer unexpectedly packed");
    assert.match(mismatchResult.stderr, /renderer identity/i);

    const starter = join(temporary, "starter");
    cpSync(repository, starter, { recursive: true, filter(source) {
      const relative = source.slice(repository.length + 1);
      const root = relative.split(/[\\/]/)[0];
      return ![".git", ".next", ".runtime", ".claude", ".gstack", ".superpowers",
        "node_modules"].includes(root);
    } });
    symlinkSync(join(repository, "node_modules"), join(starter, "node_modules"), "dir");
    expectSuccess(run(starter, ["install", rendererArchive]), "install renderer add-on");
    const generated = readFileSync(join(starter, "src/addons/generated.ts"), "utf8");
    assert.match(generated, /addonTemplateDefinitions/);
    assert.match(generated, /renderer-addon/);
    const imported = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval",
        `const value = await import("./src/addons/generated.ts");
         const definitions = value.addonTemplateDefinitions ?? value.default?.addonTemplateDefinitions;
         if (definitions?.[0]?.id !== "renderer-addon" ||
             typeof definitions[0].renderers.home !== "function") process.exit(1);`],
      { cwd: starter, encoding: "utf8", env: { ...process.env, CI: "1" } });
    expectSuccess(imported, "import generated renderer registry");
    const build = spawnSync("npm", ["run", "build"], {
      cwd: starter, encoding: "utf8", timeout: 600_000,
      env: { ...process.env, CI: "1", DIRECTORY_EXPLICIT_MIGRATIONS: "1",
        DATABASE_URL: `file:${join(temporary, "renderer-build.db")}`,
        BETTER_AUTH_SECRET: "template-products-test-secret-template-products-test-secret",
        SITE_URL: "http://127.0.0.1:3000" },
    });
    expectSuccess(build, "build installed renderer add-on");
    expectSuccess(run(starter, ["remove", "renderer-addon"]), "remove renderer add-on");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

requirementTest("TPL-002 packages the complete VECTOR directory product", () => {
  const fixture = join(repository, "fixtures/addons/vector-ai-tools");
  assert.ok(existsSync(join(fixture, "directory-addon.json")),
    "the VECTOR add-on package is missing");
  for (const path of [
    "src/theme.ts", "src/template.tsx", "src/template.css", "src/ai-tools.profile.json",
    "seed/catalog.json", "docs/README.md", "docs/CHANGELOG.md", "docs/LICENSE.md",
  ]) {
    assert.ok(existsSync(join(fixture, path)), `VECTOR is missing ${path}`);
  }

  const combinedDesignSource = ["src/theme.ts", "src/template.css"]
    .map((path) => readFileSync(join(fixture, path), "utf8")).join("\n").toUpperCase();
  for (const token of ["#0A1020", "#141D30", "#EDF2FF", "#81A4FF", "#74D5B1"]) {
    assert.match(combinedDesignSource, new RegExp(token), `VECTOR is missing ${token}`);
  }
});
