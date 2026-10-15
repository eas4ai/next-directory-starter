import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const selectedRequirement = process.env.TEMPLATE_REQUIREMENT;

function requirementTest(name, body) {
  if (!selectedRequirement || name.startsWith(selectedRequirement)) test(name, body);
}

requirementTest("TPL-001 installs constrained public-template renderer modules", () => {
  const sdkPath = join(repository, "src/lib/public-template-sdk.tsx");
  assert.ok(existsSync(sdkPath), "the public-template module SDK is missing");

  const manifestSource = readFileSync(join(repository, "scripts/addons/manifest.mjs"), "utf8");
  assert.match(manifestSource, /renderer/, "add-on manifests do not declare template renderers");

  const registrySource = readFileSync(join(repository, "scripts/addons/registry.mjs"), "utf8");
  assert.match(registrySource, /renderer/, "generated registries do not load template renderers");

  const referenceManifest = JSON.parse(readFileSync(
    join(repository, "fixtures/addons/reference-addon/directory-addon.json"), "utf8"));
  assert.equal(Object.hasOwn(referenceManifest.templates[0], "renderer"), false,
    "the stylesheet-only compatibility fixture must remain stylesheet-only");
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
