import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { chromium } from "playwright-core";
import { publicTemplateFields } from "../src/lib/public-template-sdk.tsx";

const repository = resolve(import.meta.dirname, "..");
const selectedRequirement = process.env.TEMPLATE_REQUIREMENT;

function requirementTest(name, body) {
  if (!selectedRequirement || name.startsWith(selectedRequirement)) test(name, body);
}

const ignoredCopyRoots = new Set([
  ".git", ".next", ".runtime", ".claude", ".gstack", ".superpowers", "node_modules",
]);

function copyStarter(destination) {
  cpSync(repository, destination, { recursive: true, filter(source) {
    const path = relative(repository, source);
    return !path || !ignoredCopyRoots.has(path.split(sep)[0]);
  } });
  symlinkSync(join(repository, "node_modules"), join(destination, "node_modules"), "dir");
}

function treeSnapshot(root) {
  const rows = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (ignoredCopyRoots.has(path.split("/")[0])) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isSymbolicLink()) rows.push([path, `link:${readlinkSync(absolute)}`]);
      else rows.push([path, createHash("sha256").update(readFileSync(absolute)).digest("hex")]);
    }
  }
  visit(root);
  return rows.sort(([left], [right]) => left.localeCompare(right));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const port = server.address().port;
  await new Promise((resolveClosed) => server.close(resolveClosed));
  return port;
}

function contrastRatio(rgbA, rgbB) {
  const luminance = (value) => {
    const channels = value.match(/\d+/g).slice(0, 3).map((channel) => Number(channel) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(rgbA), luminance(rgbB)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

requirementTest("TPL-001 installs constrained public-template renderer modules", () => {
  const temporary = mkdtempSync(join(tmpdir(), "directory-template-sdk-"));
  const run = (cwd, args) => spawnSync(process.execPath, ["scripts/addons.mjs", ...args], {
    cwd, encoding: "utf8", timeout: 300_000, env: { ...process.env, CI: "1" },
  });
  const expectSuccess = (result, label) => assert.equal(result.status, 0,
    `${label}: ${result.stderr || result.stdout}`);
  try {
    const publicField = {
      key: "example.profile.public", label: "Public label", help: "Visible help",
      type: "single-choice", cardinality: "one", required: false, writeAuthority: "owner",
      visibility: "public", placement: "detail", group: null, order: 1, searchable: false,
      facet: null, sort: null,
      constraints: { choices: [{ value: "one", label: "One" }] },
    };
    const fields = publicTemplateFields({
      state: { revision: 1, base: null, site: null },
      definitions: [{ schemaVersion: 1, id: "example.profile", version: "1.0.0",
        name: "Example", description: "Example fields", fields: [publicField, {
          ...publicField, key: "example.profile.private", label: "Private label",
          visibility: "private",
        }, { ...publicField, key: "example.profile.hidden", label: "Hidden label",
          placement: "hidden" }] }],
    });
    assert.deepEqual(fields.map(({ key }) => key), ["example.profile.public"]);
    assert.notEqual(fields[0], publicField, "public template received the stored field object");
    assert.ok(Object.isFrozen(fields) && Object.isFrozen(fields[0]) &&
      Object.isFrozen(fields[0].constraints) && Object.isFrozen(fields[0].constraints.choices),
    "public template fields are not deeply frozen");
    assert.throws(() => { fields[0].label = "Changed"; }, TypeError);
    assert.equal(publicField.label, "Public label");

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

    const unversioned = join(temporary, "unversioned");
    cpSync(rendererFixture, unversioned, { recursive: true });
    const unversionedManifest = join(unversioned, "directory-addon.json");
    const unversionedValue = JSON.parse(readFileSync(unversionedManifest, "utf8"));
    delete unversionedValue.templates[0].templateApi;
    writeFileSync(unversionedManifest, `${JSON.stringify(unversionedValue, null, 2)}\n`);
    const unversionedResult = run(repository,
      ["pack", unversioned, join(temporary, "unversioned.zip")]);
    assert.notEqual(unversionedResult.status, 0, "unversioned renderer unexpectedly packed");
    assert.match(unversionedResult.stderr, /templateApi 1/i);

    const forbidden = join(temporary, "forbidden");
    cpSync(rendererFixture, forbidden, { recursive: true });
    const forbiddenModule = join(forbidden, "src/template.tsx");
    writeFileSync(forbiddenModule, readFileSync(forbiddenModule, "utf8")
      .replace('import { TemplateLink } from "@/components/public-template-primitives";',
        'import { database } from "@/lib/database";'));
    const rejected = run(repository, ["pack", forbidden, join(temporary, "forbidden.zip")]);
    assert.notEqual(rejected.status, 0, "forbidden renderer import unexpectedly packed");
    assert.match(rejected.stderr, /renderer import/i);

    const constructorEscape = join(temporary, "constructor-escape");
    cpSync(rendererFixture, constructorEscape, { recursive: true });
    const constructorEscapeModule = join(constructorEscape, "src/template.tsx");
    writeFileSync(constructorEscapeModule, readFileSync(constructorEscapeModule, "utf8")
      .replace("    home({ site }) {", `    home({ site }) {
      const compile = (() => {}).constructor as unknown as
        (source: string) => () => Record<string, Record<string, Record<string, string | undefined>>>;
      const secret = compile("return this")()["process"]["env"]["BETTER_AUTH_SECRET"];`)
      .replace("data-renderer-addon=\"home\"", "data-renderer-addon=\"home\" data-secret={secret}"));
    const constructorEscapeResult = run(repository,
      ["pack", constructorEscape, join(temporary, "constructor-escape.zip")]);
    assert.notEqual(constructorEscapeResult.status, 0,
      "renderer constructor escape unexpectedly packed");
    assert.match(constructorEscapeResult.stderr, /renderer dynamic code/i);

    const mismatched = join(temporary, "mismatched");
    cpSync(rendererFixture, mismatched, { recursive: true });
    const mismatchedModule = join(mismatched, "src/template.tsx");
    writeFileSync(mismatchedModule, readFileSync(mismatchedModule, "utf8")
      .replace('id: "renderer-addon"', 'id: "other-renderer"'));
    const mismatchResult = run(repository,
      ["pack", mismatched, join(temporary, "mismatched.zip")]);
    assert.notEqual(mismatchResult.status, 0, "identity-mismatched renderer unexpectedly packed");
    assert.match(mismatchResult.stderr, /renderer identity/i);

    const illTyped = join(temporary, "ill-typed");
    cpSync(rendererFixture, illTyped, { recursive: true });
    const illTypedModule = join(illTyped, "src/template.tsx");
    writeFileSync(illTypedModule, readFileSync(illTypedModule, "utf8")
      .replace("{site.name}", "{site.missingProperty}"));
    const illTypedResult = run(repository,
      ["pack", illTyped, join(temporary, "ill-typed.zip")]);
    assert.notEqual(illTypedResult.status, 0, "ill-typed renderer unexpectedly packed");
    assert.match(illTypedResult.stderr, /does not satisfy templateApi 1/i);

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
    const buildEnvironment = { ...process.env, CI: "1", DIRECTORY_EXPLICIT_MIGRATIONS: "1",
      DATABASE_URL: `file:${join(temporary, "renderer-build.db")}`,
      BETTER_AUTH_SECRET: "template-products-test-secret-template-products-test-secret",
      SITE_URL: "http://127.0.0.1:3000" };
    const migrate = spawnSync("npm", ["run", "db:migrate"], {
      cwd: starter, encoding: "utf8", timeout: 300_000, env: buildEnvironment,
    });
    expectSuccess(migrate, "migrate isolated renderer database");
    const build = spawnSync("npm", ["run", "build"], {
      cwd: starter, encoding: "utf8", timeout: 600_000, env: buildEnvironment,
    });
    expectSuccess(build, "build installed renderer add-on");
    expectSuccess(run(starter, ["remove", "renderer-addon"]), "remove renderer add-on");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

requirementTest("TPL-002 packages the complete VECTOR directory product", async () => {
  const fixture = join(repository, "fixtures/addons/vector-ai-tools");
  assert.ok(existsSync(join(fixture, "directory-addon.json")),
    "the VECTOR add-on package is missing");
  for (const path of [
    "src/theme.ts", "src/template.tsx", "src/template.css", "src/ai-tools.profile.json",
    "seed/catalog.json", "docs/readme.md", "docs/changelog.md", "docs/license.md",
  ]) {
    assert.ok(existsSync(join(fixture, path)), `VECTOR is missing ${path}`);
  }

  const combinedDesignSource = ["src/theme.ts", "src/template.css"]
    .map((path) => readFileSync(join(fixture, path), "utf8")).join("\n").toUpperCase();
  for (const token of ["#0A1020", "#141D30", "#EDF2FF", "#81A4FF", "#74D5B1"]) {
    assert.match(combinedDesignSource, new RegExp(token), `VECTOR is missing ${token}`);
  }

  const profile = JSON.parse(readFileSync(join(fixture, "src/ai-tools.profile.json"), "utf8"));
  const fieldBySuffix = new Map(profile.fields.map((field) =>
    [field.key.replace("vector-ai-tools.ai-tools.", ""), field]));
  for (const name of ["pricing-model", "starting-price", "free-tier", "platforms", "integrations",
    "open-source", "verified-launch", "launch-status", "launch-date", "last-verified"]) {
    assert.ok(fieldBySuffix.has(name), `VECTOR profile is missing ${name}`);
  }
  assert.equal(fieldBySuffix.get("verified-launch").writeAuthority, "operator");
  assert.equal(fieldBySuffix.get("last-verified").writeAuthority, "operator");
  const seed = JSON.parse(readFileSync(join(fixture, "seed/catalog.json"), "utf8"));
  assert.ok(seed.listings.length >= 9, "VECTOR needs representative public and private seed states");
  assert.ok(seed.listings.some(({ status }) => status === "draft"),
    "VECTOR seed does not exercise an ineligible draft");
  assert.ok(seed.listings.some(({ profileValues }) =>
    profileValues["vector-ai-tools.ai-tools.verified-launch"] === false),
  "VECTOR seed does not exercise an unverified launch");
  const signalColor = /#74D5B1/i;
  const decorativeAssets = [
    "public/vector-mark.svg", "public/diagrams/stack-map.svg",
    ...readdirSync(join(fixture, "public/marks")).map((name) => `public/marks/${name}`),
  ];
  for (const path of decorativeAssets) {
    assert.doesNotMatch(readFileSync(join(fixture, path), "utf8"), signalColor,
      `${path} uses the verified signal color without a verified data state`);
  }
  const themeSource = readFileSync(join(fixture, "src/theme.ts"), "utf8");
  assert.doesNotMatch(themeSource, /social:\s*\{[^}]*muted:\s*"#74D5B1"/i,
    "generic social-card text uses the verified signal color");
  assert.doesNotMatch(themeSource, /"chart-2":\s*"#74D5B1"/i,
    "a generic chart series uses the verified signal color");
  assert.match(readFileSync(join(fixture, "src/template.css"), "utf8"),
    /--vector-signal:\s*#74D5B1/i,
    "the verified data state lost its approved dark-mode signal color");

  const temporary = mkdtempSync(join(tmpdir(), "vector-template-product-"));
  let application;
  const addon = (cwd, args) => spawnSync(process.execPath, ["scripts/addons.mjs", ...args], {
    cwd, encoding: "utf8", timeout: 300_000, env: { ...process.env, CI: "1" },
  });
  const npm = (cwd, args, env, timeout = 600_000) => spawnSync("npm", args, {
    cwd, encoding: "utf8", timeout, env: { ...process.env, CI: "1", ...env },
  });
  const expectSuccess = (result, label) => assert.equal(result.status, 0,
    `${label}: ${result.stderr || result.stdout}`);
  try {
    const firstArchive = join(temporary, "vector-first.zip");
    const secondArchive = join(temporary, "vector-second.zip");
    expectSuccess(addon(repository, ["pack", fixture, firstArchive]), "pack VECTOR archive");
    expectSuccess(addon(repository, ["pack", fixture, secondArchive]), "repack VECTOR archive");
    assert.deepEqual(readFileSync(firstArchive), readFileSync(secondArchive),
      "equal VECTOR sources did not produce a byte-identical archive");
    expectSuccess(addon(repository, ["validate", firstArchive]), "validate VECTOR archive");

    const starter = join(temporary, "starter");
    copyStarter(starter);
    const baseline = treeSnapshot(starter);
    const databasePath = join(temporary, `vector-${randomBytes(6).toString("hex")}.db`);
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const env = {
      DATABASE_URL: `file:${databasePath}`,
      DIRECTORY_EXPLICIT_MIGRATIONS: "1",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      SITE_URL: origin,
      BETTER_AUTH_URL: origin,
    };
    assert.equal(existsSync(databasePath), false);
    expectSuccess(addon(starter, ["install", firstArchive]), "install VECTOR archive");
    assert.equal(existsSync(databasePath), false, "VECTOR installation opened the operator database");
    assert.ok(existsSync(join(starter, "src/addons/vector-ai-tools/docs/readme.md")));
    expectSuccess(npm(starter, ["run", "db:migrate"], env), "migrate VECTOR database");
    expectSuccess(npm(starter, ["run", "build"], env), "build installed VECTOR product");

    const activate = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const profilesModule = await import("./src/lib/directory-profiles.ts");
        const brandingModule = await import("./src/lib/branding.ts");
        const databaseModule = await import("./src/lib/database.ts");
        const themeModule = await import("./src/lib/theme-selection.ts");
        const profiles = profilesModule.default ?? profilesModule;
        const branding = brandingModule.default ?? brandingModule;
        const database = databaseModule.database ?? databaseModule.default?.database;
        const themes = themeModule.default ?? themeModule;
        const now = new Date().toISOString();
        database.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run("vector-admin", "VECTOR Admin", "vector-admin@example.invalid", 1,
            now, now, "admin", 0);
        branding.saveBranding({ name: "Operator Atlas",
          description: "Operator-owned AI tool intelligence.",
          logoUrl: "/addons/vector-ai-tools/marks/arc-forge.svg",
          iconUrl: null, socialImage: null }, "vector-admin");
        const available = profiles.availableDirectoryProfiles();
        if (!available.some((item) => item.profileId === "vector-ai-tools.ai-tools" &&
            item.version === "1.0.0" && item.sourceId === "vector-ai-tools")) process.exit(2);
        let rejected = false;
        try {
          themes.saveThemeSelection({ themeId: "vector-ai-tools",
            templateId: "vector-ai-tools" }, "vector-admin");
        } catch (error) {
          rejected = /compatible|profile/i.test(String(error));
        }
        if (!rejected) process.exit(3);
        profiles.activateDirectoryProfile({
          definition: profiles.availableDirectoryProfileDefinition(
            "vector-ai-tools.ai-tools", "1.0.0"),
          sourceKind: "addon", sourceId: "vector-ai-tools", expectedRevision: 0,
          actorUserId: "vector-admin",
        });`],
      { cwd: starter, encoding: "utf8", env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(activate, "activate VECTOR profile");

    const select = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const imported = await import("./src/lib/theme-selection.ts");
        const profilesModule = await import("./src/lib/directory-profiles.ts");
        const redirectsModule = await import("./src/lib/seo-redirects.ts");
        const settingsModule = await import("./src/lib/site-settings.ts");
        const api = imported.default ?? imported;
        const profiles = profilesModule.default ?? profilesModule;
        const redirects = redirectsModule.default ?? redirectsModule;
        const settings = settingsModule.default ?? settingsModule;
        if (!api.templateOptions.some((item) => item.id === "vector-ai-tools")) process.exit(2);
        if (!api.themeChoices.some((item) => item.id === "vector-ai-tools")) process.exit(3);
        const selection = api.saveThemeSelection({ themeId: "vector-ai-tools",
          templateId: "vector-ai-tools" }, "vector-admin");
        if (selection.templateId !== "vector-ai-tools") process.exit(4);
        const original = profiles.availableDirectoryProfileDefinition(
          "vector-ai-tools.ai-tools", "1.0.0");
        profiles.activateDirectoryProfile({ definition: { ...original, version: "9.0.0" },
          sourceKind: "addon", sourceId: "vector-ai-tools", expectedRevision: 1,
          actorUserId: "vector-admin" });
        if (api.getThemeSelection().templateId !== "classic") process.exit(5);
        if (JSON.parse(settings.readSiteSetting("theme_selection")).templateId !== "classic") process.exit(6);
        profiles.activateDirectoryProfile({ definition: original, sourceKind: "addon",
          sourceId: "vector-ai-tools", expectedRevision: 2, actorUserId: "vector-admin" });
        const restored = api.saveThemeSelection({ themeId: "vector-ai-tools",
          templateId: "vector-ai-tools" }, "vector-admin");
        if (restored.templateId !== "vector-ai-tools") process.exit(7);
        let redirectRejected = false;
        try { redirects.saveRedirect("/compare", "/listings", "vector-admin"); }
        catch (error) { redirectRejected = /shadow|live route/i.test(String(error)); }
        if (!redirectRejected) process.exit(8);`],
      { cwd: starter, encoding: "utf8", env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(select, "select VECTOR theme and template");
    expectSuccess(npm(starter, ["run", "addon:seed", "--", "vector-ai-tools"], env),
      "seed VECTOR catalog");
    const legacyRedirect = new Database(databasePath);
    try {
      const now = new Date().toISOString();
      legacyRedirect.prepare(`INSERT INTO seo_redirects
        (source_path, destination_path, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run("/compare", "/listings", now, now);
    } finally {
      legacyRedirect.close();
    }

    application = spawn("npm", ["run", "start", "--", "-p", String(port)], {
      cwd: starter, env: { ...process.env, CI: "1", ...env }, detached: true, stdio: "ignore",
    });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).status < 500) {
          ready = true;
          break;
        }
      } catch { /* wait for the production server */ }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    assert.ok(ready, "installed VECTOR production server did not start");
    const html = async (path) => {
      const response = await fetch(`${origin}${path}`);
      const body = await response.text();
      assert.equal(response.status, 200, `${path}: ${body}`);
      return body;
    };
    const results = (body) => [...body.matchAll(/data-vector-result="([a-z0-9-]+)"/g)]
      .map((match) => match[1]);

    const home = await html("/");
    assert.match(home, /Discover tools that/);
    assert.match(home, /<strong>Operator Atlas<\/strong>/);
    assert.match(home, /src="\/addons\/vector-ai-tools\/marks\/arc-forge\.svg"/);
    const directory = await html("/listings");
    assert.deepEqual(new Set(results(directory)), new Set([
      "agent-relay", "arc-forge", "briefly", "codepilot-local", "data-lens", "pixel-flow",
      "signal-lab", "voice-mesh",
    ]));
    assert.doesNotMatch(directory, /Shadow Preview/);
    assert.doesNotMatch(directory, /<option value="Video">/,
      "a category backed only by a draft leaked into public filters");
    assert.doesNotMatch(directory, /\$(?:1|5) \/ mo/,
      "usage pricing was presented as an invented monthly price");
    assert.match(directory, /From \$1\.00/);
    assert.match(directory, /From \$5\.00/);

    const filtered = async (entries) => results(await html(`/listings?${new URLSearchParams(entries)}`));
    assert.deepEqual(new Set(await filtered([["facet.vector-ai-tools.ai-tools.pricing-model", "usage"]])),
      new Set(["agent-relay", "signal-lab"]));
    assert.deepEqual(new Set(await filtered([["facet.vector-ai-tools.ai-tools.integrations", "github"]])),
      new Set(["agent-relay", "codepilot-local", "signal-lab"]));
    assert.deepEqual(new Set(await filtered([["facet.vector-ai-tools.ai-tools.open-source", "true"]])),
      new Set(["agent-relay", "codepilot-local", "signal-lab"]));
    assert.deepEqual(new Set(await filtered([["facet.vector-ai-tools.ai-tools.verified-launch", "true"]])),
      new Set(["arc-forge", "codepilot-local", "data-lens", "pixel-flow", "signal-lab", "voice-mesh"]));
    assert.deepEqual(new Set(await filtered([["facet.vector-ai-tools.ai-tools.launch-status", "new"]])),
      new Set(["agent-relay", "arc-forge", "pixel-flow"]));
    assert.deepEqual(new Set(await filtered([["facet.vector-ai-tools.ai-tools.free-tier", "true"]])),
      new Set(["agent-relay", "arc-forge", "briefly", "codepilot-local", "signal-lab"]));
    assert.deepEqual(await filtered([["q", "residency"]]), ["codepilot-local"]);
    const launchOrder = await filtered([["sort", "vector-ai-tools.ai-tools.launch-date:desc"]]);
    assert.deepEqual(launchOrder.slice(0, 3), ["agent-relay", "arc-forge", "pixel-flow"]);

    const comparison = await html("/compare?tool=arc-forge&tool=signal-lab");
    assert.match(comparison, /Arc Forge/);
    assert.match(comparison, /Signal Lab/);
    assert.match(comparison, /Starting price/);
    assert.match(comparison, /Verified launch/);
    const comparisonWithMissingFact = await html("/compare?tool=arc-forge&tool=data-lens");
    assert.match(comparisonWithMissingFact, /Not disclosed/,
      "comparison silently blanked an optional product fact");
    assert.match(await html("/compare?tool=arc-forge&tool=arc-forge"), /2 to 4 unique tools/);
    assert.match(await html("/compare?tool=arc-forge&tool=signal-lab&tool=briefly&tool=pixel-flow&tool=voice-mesh"),
      /2 to 4 unique tools/);
    const ineligible = await html("/compare?tool=arc-forge&tool=shadow-preview");
    assert.match(ineligible, /One or more tools are unavailable/);
    assert.doesNotMatch(ineligible, /Shadow Preview/);

    const detail = await html("/listings/arc-forge");
    assert.match(detail, new RegExp(`<link rel="canonical" href="${origin}/listings/arc-forge"`));
    assert.match(detail, /application\/ld\+json/);
    assert.match(detail, /Verified launch/);
    const markdown = await fetch(`${origin}/markdown/listings/arc-forge`);
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /Arc Forge/);

    const browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
      args: ["--no-sandbox"] });
    try {
      const narrow = await browser.newContext({ viewport: { width: 320, height: 900 },
        colorScheme: "dark", javaScriptEnabled: false });
      await narrow.addCookies([{ name: "site_appearance", value: "dark", url: origin }]);
      const page = await narrow.newPage();
      await page.goto(`${origin}/listings`);
      assert.equal(await page.locator("html").getAttribute("data-template"), "vector-ai-tools");
      assert.equal(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
        "rgb(10, 16, 32)");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <=
        document.documentElement.clientWidth), "VECTOR overflows at 320 pixels");
      const background = await page.locator("body").evaluate((element) =>
        getComputedStyle(element).backgroundColor);
      const foreground = await page.locator("body").evaluate((element) =>
        getComputedStyle(element).color);
      assert.ok(contrastRatio(background, foreground) >= 7,
        `VECTOR dark text contrast is too low: ${background} / ${foreground}`);
      await page.locator('input[name="tool"][value="arc-forge"]').focus();
      await page.keyboard.press("Space");
      assert.ok(await page.locator('input[name="tool"][value="arc-forge"]').isChecked());
      await page.locator('input[name="tool"][value="signal-lab"]').check();
      await Promise.all([
        page.waitForURL(/\/compare\?/),
        page.getByRole("button", { name: /Compare selected/ }).click(),
      ]);
      assert.match(await page.locator("body").innerText(), /Compare your shortlist/i);
      await narrow.close();

      const light = await browser.newContext({ viewport: { width: 1280, height: 900 },
        colorScheme: "light" });
      await light.addCookies([{ name: "site_appearance", value: "light", url: origin }]);
      const lightPage = await light.newPage();
      await lightPage.goto(origin);
      assert.equal(await lightPage.locator("body").evaluate((element) =>
        getComputedStyle(element).backgroundColor), "rgb(244, 247, 255)");
      await light.close();
    } finally {
      await browser.close();
    }

    process.kill(-application.pid, "SIGTERM");
    application = null;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    expectSuccess(addon(starter, ["remove", "vector-ai-tools"]), "remove VECTOR archive");
    const retained = new Database(databasePath, { readonly: true });
    try {
      assert.equal(retained.prepare("SELECT COUNT(*) FROM listings WHERE slug = ?")
        .pluck().get("arc-forge"), 1, "VECTOR removal deleted seeded operator data");
    } finally {
      retained.close();
    }
    const fallback = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const imported = await import("./src/lib/theme-selection.ts");
        const api = imported.default ?? imported;
        const selected = api.getThemeSelection();
        if (selected.themeId !== "preset" || selected.templateId !== "classic") process.exit(2);`],
      { cwd: starter, encoding: "utf8", env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(fallback, "fallback after VECTOR removal");
    assert.deepEqual(treeSnapshot(starter), baseline,
      "VECTOR remove did not restore the unchanged starter source");
  } finally {
    if (application?.pid) {
      try { process.kill(-application.pid, "SIGTERM"); } catch { /* already stopped */ }
    }
    rmSync(temporary, { recursive: true, force: true });
  }
});

requirementTest("TPL-003 packages the complete BOROUGH local-city directory product", async () => {
  const fixture = join(repository, "fixtures/addons/borough-city-guide");
  assert.ok(existsSync(join(fixture, "directory-addon.json")),
    "the BOROUGH add-on package is missing");
  for (const path of [
    "src/theme.ts", "src/template.tsx", "src/template.css", "src/places.profile.json",
    "seed/catalog.json", "docs/readme.md", "docs/changelog.md", "docs/license.md",
  ]) {
    assert.ok(existsSync(join(fixture, path)), `BOROUGH is missing ${path}`);
  }

  const combinedDesignSource = ["src/theme.ts", "src/template.css"]
    .map((path) => readFileSync(join(fixture, path), "utf8")).join("\n").toUpperCase();
  for (const token of ["#F5EDE0", "#FFF8EC", "#302C25", "#A54A30", "#839179"]) {
    assert.match(combinedDesignSource, new RegExp(token), `BOROUGH is missing ${token}`);
  }
  assert.match(combinedDesignSource, /2PX|0\.125REM/,
    "BOROUGH does not preserve the approved two-pixel corner geometry");

  const profile = JSON.parse(readFileSync(join(fixture, "src/places.profile.json"), "utf8"));
  assert.equal(profile.id, "borough-city-guide.places");
  assert.equal(profile.version, "1.0.0");
  const fieldBySuffix = new Map(profile.fields.map((field) =>
    [field.key.replace("borough-city-guide.places.", ""), field]));
  const expectedFields = new Map([
    ["neighborhood", "single-choice"], ["place-type", "single-choice"],
    ["address", "short-text"], ["location", "location"],
    ["price-level", "single-choice"], ["accessibility", "multiple-choice"],
    ["best-for", "multiple-choice"], ["visit-duration", "duration"],
    ["curator-note", "markdown"], ["editorial-pick", "boolean"],
    ["trails", "multiple-choice"], ["photography", "media"],
  ]);
  for (const [name, type] of expectedFields) {
    assert.equal(fieldBySuffix.get(name)?.type, type, `BOROUGH profile is missing ${name}`);
  }
  for (const name of ["curator-note", "editorial-pick", "trails"]) {
    assert.equal(fieldBySuffix.get(name).writeAuthority, "operator",
      `${name} is not operator controlled`);
  }

  const seed = JSON.parse(readFileSync(join(fixture, "seed/catalog.json"), "utf8"));
  assert.ok(seed.listings.length >= 9, "BOROUGH needs representative public and private states");
  assert.ok(seed.listings.some(({ status }) => status === "draft"),
    "BOROUGH seed does not exercise an ineligible draft");
  const publishedSeed = seed.listings.filter(({ status }) => status === "published");
  const imageSources = seed.listings.flatMap(({ media = [] }) => media.map(({ source }) => source));
  assert.ok(imageSources.length >= publishedSeed.length,
    "BOROUGH needs representative photography for its published places");
  assert.equal(new Set(imageSources).size, imageSources.length,
    "BOROUGH seed reuses a packaged photograph identity");
  const manifest = JSON.parse(readFileSync(join(fixture, "directory-addon.json"), "utf8"));
  const brandAsset = "public/borough-mark.svg";
  assert.ok(manifest.assets.includes(brandAsset),
    "BOROUGH does not declare its namespaced brand asset");
  assert.ok(manifest.files.includes(brandAsset),
    "BOROUGH brand asset is not owned by the package");
  assert.match(readFileSync(join(fixture, brandAsset), "utf8"), /<svg[\s>]/i,
    "BOROUGH brand asset is not an SVG mark");
  for (const source of imageSources) {
    assert.match(source, /^seed\/media\/[a-z0-9][a-z0-9._-]*$/,
      `unsafe BOROUGH seed media path: ${source}`);
    assert.ok(manifest.files.includes(source), `BOROUGH media is undeclared: ${source}`);
    assert.ok(readFileSync(join(fixture, source)).length > 1_024,
      `BOROUGH photograph is empty or implausibly small: ${source}`);
  }
  const photoDigests = imageSources.map((source) =>
    createHash("sha256").update(readFileSync(join(fixture, source))).digest("hex"));
  assert.equal(new Set(photoDigests).size, photoDigests.length,
    "BOROUGH seed repeats the same photograph under different names");

  const temporary = mkdtempSync(join(tmpdir(), "borough-template-product-"));
  let application;
  const addon = (cwd, args) => spawnSync(process.execPath, ["scripts/addons.mjs", ...args], {
    cwd, encoding: "utf8", timeout: 300_000, env: { ...process.env, CI: "1" },
  });
  const npm = (cwd, args, env, timeout = 600_000) => spawnSync("npm", args, {
    cwd, encoding: "utf8", timeout, env: { ...process.env, CI: "1", ...env },
  });
  const expectSuccess = (result, label) => assert.equal(result.status, 0,
    `${label}: ${result.stderr || result.stdout}`);
  try {
    const firstArchive = join(temporary, "borough-first.zip");
    const secondArchive = join(temporary, "borough-second.zip");
    expectSuccess(addon(repository, ["pack", fixture, firstArchive]), "pack BOROUGH archive");
    expectSuccess(addon(repository, ["pack", fixture, secondArchive]), "repack BOROUGH archive");
    assert.deepEqual(readFileSync(firstArchive), readFileSync(secondArchive),
      "equal BOROUGH sources did not produce a byte-identical archive");
    expectSuccess(addon(repository, ["validate", firstArchive]), "validate BOROUGH archive");

    const corrupt = join(temporary, "corrupt-source");
    cpSync(fixture, corrupt, { recursive: true });
    writeFileSync(join(corrupt, imageSources[0]), "not an image");
    const corruptResult = addon(repository, ["pack", corrupt, join(temporary, "corrupt.zip")]);
    assert.notEqual(corruptResult.status, 0, "corrupt seed photography unexpectedly packed");
    assert.match(corruptResult.stderr, /image|media|photograph/i);

    const escaping = join(temporary, "escaping-source");
    cpSync(fixture, escaping, { recursive: true });
    const escapingSeedPath = join(escaping, "seed/catalog.json");
    const escapingSeed = JSON.parse(readFileSync(escapingSeedPath, "utf8"));
    escapingSeed.listings[0].media[0].source = "seed/media/../outside.webp";
    writeFileSync(escapingSeedPath, `${JSON.stringify(escapingSeed, null, 2)}\n`);
    const escapingResult = addon(repository,
      ["pack", escaping, join(temporary, "escaping.zip")]);
    assert.notEqual(escapingResult.status, 0, "path-escaping seed photography unexpectedly packed");
    assert.match(escapingResult.stderr, /path|media|unsafe/i);

    const starter = join(temporary, "starter");
    copyStarter(starter);
    const baseline = treeSnapshot(starter);
    const databasePath = join(temporary, `borough-${randomBytes(6).toString("hex")}.db`);
    const mediaDirectory = join(dirname(databasePath), "media");
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const billingKey = randomBytes(32).toString("base64url");
    const env = {
      DATABASE_URL: `file:${databasePath}`,
      DIRECTORY_EXPLICIT_MIGRATIONS: "1",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BILLING_ENCRYPTION_KEY: billingKey,
      BILLING_CHECKOUT_MODE: "test",
      SITE_URL: origin,
      BETTER_AUTH_URL: origin,
    };
    assert.equal(existsSync(databasePath), false);
    expectSuccess(addon(starter, ["install", firstArchive]), "install BOROUGH archive");
    assert.equal(existsSync(databasePath), false, "BOROUGH installation opened the operator database");
    assert.equal(existsSync(mediaDirectory), false, "BOROUGH installation wrote runtime media");
    expectSuccess(npm(starter, ["run", "db:migrate"], env), "migrate BOROUGH database");
    expectSuccess(npm(starter, ["run", "build"], env), "build installed BOROUGH product");

    const activate = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const profilesModule = await import("./src/lib/directory-profiles.ts");
        const databaseModule = await import("./src/lib/database.ts");
        const themeModule = await import("./src/lib/theme-selection.ts");
        const profiles = profilesModule.default ?? profilesModule;
        const database = databaseModule.database ?? databaseModule.default?.database;
        const themes = themeModule.default ?? themeModule;
        const now = new Date().toISOString();
        database.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run("borough-admin", "BOROUGH Admin", "borough-admin@example.invalid", 1,
            now, now, "admin", 0);
        const definition = profiles.availableDirectoryProfileDefinition(
          "borough-city-guide.places", "1.0.0");
        profiles.activateDirectoryProfile({ definition, sourceKind: "addon",
          sourceId: "borough-city-guide", expectedRevision: 0,
          actorUserId: "borough-admin" });
        const selected = themes.saveThemeSelection({ themeId: "borough-city-guide",
          templateId: "borough-city-guide" }, "borough-admin");
        if (selected.templateId !== "borough-city-guide") process.exit(2);`],
      { cwd: starter, encoding: "utf8",
        env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(activate, "activate and select BOROUGH");

    const reservationId = randomUUID();
    const reserveMedia = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const fs = await import("node:fs");
        const path = await import("node:path");
        const imported = await import("./src/lib/media.ts");
        const media = imported.default ?? imported;
        const id = ${JSON.stringify(reservationId)};
        media.reserveMediaFileCleanup(id);
        const file = media.mediaFilePath(id);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "in-flight seed media");`],
      { cwd: starter, encoding: "utf8", env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(reserveMedia, "reserve an in-flight BOROUGH media write");
    const reservationFile = join(mediaDirectory, `${reservationId}.webp`);
    assert.ok(existsSync(reservationFile));
    const concurrentDrain = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const imported = await import("./src/lib/media.ts");
        const media = imported.default ?? imported;
        media.drainMediaCleanupQueue();`],
      { cwd: starter, encoding: "utf8", env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(concurrentDrain, "run a concurrent media cleanup process");
    assert.ok(existsSync(reservationFile),
      "a concurrent drainer deleted an in-flight BOROUGH media write");
    const reservationDb = new Database(databasePath);
    try {
      reservationDb.prepare("UPDATE media_cleanup_queue SET queued_at = ? WHERE asset_id = ?")
        .run(new Date(Date.now() - 1_000).toISOString(), reservationId);
    } finally {
      reservationDb.close();
    }
    const expiredDrain = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const imported = await import("./src/lib/media.ts");
        const media = imported.default ?? imported;
        media.drainMediaCleanupQueue();`],
      { cwd: starter, encoding: "utf8", env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(expiredDrain, "drain an expired media write reservation");
    assert.equal(existsSync(reservationFile), false,
      "an expired BOROUGH media reservation did not clean its runtime file");

    const failureDb = new Database(databasePath);
    try {
      failureDb.exec(`CREATE TRIGGER reject_borough_media BEFORE INSERT ON media_assets
        BEGIN SELECT RAISE(ABORT, 'deliberate BOROUGH media failure'); END`);
    } finally {
      failureDb.close();
    }
    const mediaBeforeFailure = existsSync(mediaDirectory) ? readdirSync(mediaDirectory).sort() : [];
    const failedSeed = npm(starter, ["run", "addon:seed", "--", "borough-city-guide"], env);
    assert.notEqual(failedSeed.status, 0, "BOROUGH seed ignored a media transaction failure");
    const afterFailureDb = new Database(databasePath);
    try {
      assert.equal(afterFailureDb.prepare("SELECT COUNT(*) FROM listings").pluck().get(), 0,
        "failed BOROUGH seed left listings behind");
      assert.equal(afterFailureDb.prepare("SELECT COUNT(*) FROM media_assets").pluck().get(), 0,
        "failed BOROUGH seed left media records behind");
      assert.equal(afterFailureDb.prepare("SELECT COUNT(*) FROM directory_profile_seed_runs")
        .pluck().get(), 0, "failed BOROUGH seed was recorded as complete");
      afterFailureDb.exec("DROP TRIGGER reject_borough_media");
    } finally {
      afterFailureDb.close();
    }
    assert.deepEqual(existsSync(mediaDirectory) ? readdirSync(mediaDirectory).sort() : [],
      mediaBeforeFailure, "failed BOROUGH seed left runtime media behind");

    expectSuccess(npm(starter, ["run", "addon:seed", "--", "borough-city-guide"], env),
      "seed BOROUGH catalog and photography");
    const seededDb = new Database(databasePath);
    let mediaRows;
    const featuredSlug = publishedSeed[0].slug;
    try {
      assert.equal(seededDb.prepare("SELECT COUNT(*) FROM listings").pluck().get(),
        seed.listings.length);
      mediaRows = seededDb.prepare(`SELECT a.id, a.target_slug, a.alt, p.state
        FROM media_assets a JOIN directory_profile_media p ON p.asset_id = a.id
        ORDER BY a.target_slug, a.id`).all();
      assert.equal(mediaRows.length, imageSources.length,
        "BOROUGH did not create one media record per packaged photograph");
      assert.equal(seededDb.prepare("SELECT COUNT(*) FROM directory_profile_media").pluck().get(),
        imageSources.length, "BOROUGH photography is not assigned to profile values");
      assert.equal(seededDb.prepare("SELECT COUNT(*) FROM directory_profile_seed_runs")
        .pluck().get(), 1);
      const featuredStartsAt = new Date(Date.now() - 60_000).toISOString();
      const featuredEndsAt = new Date(Date.now() + 86_400_000).toISOString();
      seededDb.prepare(`INSERT INTO publishing_plans
        (key, name, description, mode, billing_mode, amount_minor, currency, duration_days,
          featured, enabled, updated_at)
        VALUES ('borough-featured', 'Featured place', '', 'test', 'one-time',
          2500, 'usd', 1, 1, 1, ?)`)
        .run(featuredStartsAt);
      seededDb.prepare(`INSERT INTO purchases
        (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
          plan_description, amount_minor, currency, duration_days, accepted_duration_days,
          featured, stripe_session_id, status, created_at, provider)
        VALUES ('borough-featured-purchase', ?, 'borough-admin', 'borough-featured', 'test',
          'one-time', 'Featured place', '', 2500, 'usd', 1, 1, 1,
          'pending:borough-featured-purchase', 'paid', ?, 'stripe')`)
        .run(featuredSlug, featuredStartsAt);
      seededDb.prepare(`INSERT INTO entitlements
        (purchase_id, listing_slug, starts_at, ends_at, featured, revoked_at)
        VALUES ('borough-featured-purchase', ?, ?, ?, 1, NULL)`)
        .run(featuredSlug, featuredStartsAt, featuredEndsAt);
    } finally {
      seededDb.close();
    }
    for (const { id } of mediaRows) {
      assert.ok(existsSync(join(mediaDirectory, `${id}.webp`)),
        `seeded BOROUGH media file is missing: ${id}`);
    }
    expectSuccess(npm(starter, ["run", "addon:seed", "--", "borough-city-guide"], env),
      "repeat BOROUGH seed");
    const repeatedDb = new Database(databasePath, { readonly: true });
    try {
      assert.equal(repeatedDb.prepare("SELECT COUNT(*) FROM listings").pluck().get(),
        seed.listings.length, "repeated BOROUGH seed duplicated listings");
      assert.equal(repeatedDb.prepare("SELECT COUNT(*) FROM media_assets").pluck().get(),
        imageSources.length, "repeated BOROUGH seed duplicated media");
    } finally {
      repeatedDb.close();
    }

    application = spawn("npm", ["run", "start", "--", "-p", String(port)], {
      cwd: starter, env: { ...process.env, CI: "1", ...env }, detached: true, stdio: "ignore",
    });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).status < 500) {
          ready = true;
          break;
        }
      } catch { /* wait for the production server */ }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    assert.ok(ready, "installed BOROUGH production server did not start");
    const html = async (path) => {
      const response = await fetch(`${origin}${path}`);
      const body = await response.text();
      assert.equal(response.status, 200, `${path}: ${body}`);
      return body;
    };
    const results = (body) => [...body.matchAll(/data-borough-result="([a-z0-9-]+)"/g)]
      .map((match) => match[1]);
    const publicSlugs = publishedSeed.map(({ slug }) => slug).sort();

    const home = await html("/");
    assert.match(home, /The city, known by locals\./);
    assert.match(home, /\/addons\/borough-city-guide\/borough-mark\.svg/,
      "BOROUGH does not render its installed namespaced brand mark");
    assert.match(home, /data-borough-neighborhood=/);
    assert.match(home, /data-borough-trail=/);
    assert.doesNotMatch(home, /hidden-draft/);
    assert.ok([...home.matchAll(/data-borough-place=/g)].length <= 24,
      "BOROUGH home discovery is not bounded");
    const directory = await html("/listings");
    assert.deepEqual(results(directory).sort(), publicSlugs);
    assert.match(directory, new RegExp(`data-borough-featured="${featuredSlug}"`),
      "BOROUGH dropped the separate paid featured placement");
    assert.match(directory, /Featured placement/,
      "BOROUGH did not label its paid featured placement");
    assert.doesNotMatch(directory, /hidden-draft/);
    assert.match(directory, /src="\/media\/[0-9a-f-]{36}"/,
      "BOROUGH directory does not use eligible runtime photography");

    const filtered = async (entries) => results(await html(`/listings?${new URLSearchParams(entries)}`));
    const fieldKey = (suffix) => `borough-city-guide.places.${suffix}`;
    const firstNeighborhood = publishedSeed[0].profileValues[fieldKey("neighborhood")];
    const expectedNeighborhood = publishedSeed.filter(({ profileValues }) =>
      profileValues[fieldKey("neighborhood")] === firstNeighborhood).map(({ slug }) => slug).sort();
    assert.deepEqual((await filtered([[`facet.${fieldKey("neighborhood")}`, firstNeighborhood]])).sort(),
      expectedNeighborhood);
    const firstTrail = publishedSeed[0].profileValues[fieldKey("trails")][0];
    const expectedTrail = publishedSeed.filter(({ profileValues }) =>
      profileValues[fieldKey("trails")].includes(firstTrail)).map(({ slug }) => slug).sort();
    assert.deepEqual((await filtered([[`facet.${fieldKey("trails")}`, firstTrail]])).sort(),
      expectedTrail);
    assert.deepEqual(await filtered([["q", publishedSeed[0].title]]), [publishedSeed[0].slug]);
    const expectedDuration = [...publishedSeed].sort((left, right) =>
      left.profileValues[fieldKey("visit-duration")] -
      right.profileValues[fieldKey("visit-duration")]).map(({ slug }) => slug);
    assert.deepEqual(await filtered([["sort", `${fieldKey("visit-duration")}:asc`]]),
      expectedDuration);

    const editorial = publishedSeed.find(({ slug, profileValues }) =>
      profileValues[fieldKey("editorial-pick")] === true &&
      home.includes(`data-borough-place="${slug}"`));
    assert.ok(editorial, "BOROUGH home needs a live editorial pick");
    const detail = await html(`/listings/${editorial.slug}`);
    assert.match(detail, /Curator note/);
    assert.doesNotMatch(detail, /visitor review/i);
    assert.match(detail, /application\/ld\+json/);
    assert.match(detail, new RegExp(`<link rel="canonical" href="${origin}/listings/${editorial.slug}"`));
    const markdown = await fetch(`${origin}/markdown/listings/${editorial.slug}`);
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), new RegExp(editorial.title));

    const liveEditDb = new Database(databasePath);
    const originalName = editorial.title;
    const editedName = "A Operator-edited local favorite";
    try {
      liveEditDb.prepare("UPDATE listings SET name = ? WHERE slug = ?")
        .run(editedName, editorial.slug);
      assert.match(await html("/"), new RegExp(editedName),
        "BOROUGH home remained stale after an operator edit");
      const now = new Date().toISOString();
      liveEditDb.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run("borough-banned-owner", "Banned owner", "borough-banned@example.invalid", 1,
          now, now, "user", 1);
      liveEditDb.prepare("UPDATE listings SET owner_user_id = ? WHERE slug = ?")
        .run("borough-banned-owner", editorial.slug);
      const bannedHome = await html("/");
      assert.doesNotMatch(bannedHome, new RegExp(editedName),
        "a banned owner's listing leaked onto the BOROUGH home page");
      liveEditDb.prepare("UPDATE listings SET owner_user_id = NULL, name = ? WHERE slug = ?")
        .run(originalName, editorial.slug);
      const mediaId = mediaRows.find(({ target_slug: slug }) => slug === editorial.slug).id;
      liveEditDb.prepare("UPDATE directory_profile_media SET state = 'draft' WHERE asset_id = ?")
        .run(mediaId);
      assert.doesNotMatch(await html(`/listings/${editorial.slug}`), new RegExp(`/media/${mediaId}`),
        "private photography leaked through BOROUGH");
      liveEditDb.prepare("UPDATE directory_profile_media SET state = 'public' WHERE asset_id = ?")
        .run(mediaId);
    } finally {
      liveEditDb.close();
    }

    const browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
      args: ["--no-sandbox"] });
    try {
      const narrow = await browser.newContext({ viewport: { width: 320, height: 900 },
        colorScheme: "dark", javaScriptEnabled: false });
      await narrow.addCookies([{ name: "site_appearance", value: "dark", url: origin }]);
      const page = await narrow.newPage();
      await page.goto(`${origin}/listings`);
      assert.equal(await page.locator("html").getAttribute("data-template"), "borough-city-guide");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <=
        document.documentElement.clientWidth), "BOROUGH overflows at 320 pixels");
      const background = await page.locator("body").evaluate((element) =>
        getComputedStyle(element).backgroundColor);
      const foreground = await page.locator("body").evaluate((element) =>
        getComputedStyle(element).color);
      assert.ok(contrastRatio(background, foreground) >= 4.5,
        `BOROUGH dark text contrast is too low: ${background} / ${foreground}`);
      const firstLink = page.locator("a").first();
      await firstLink.focus();
      assert.equal(await firstLink.evaluate((element) => element === document.activeElement), true,
        "BOROUGH navigation cannot receive keyboard focus");
      await narrow.close();

      const light = await browser.newContext({ viewport: { width: 1280, height: 900 },
        colorScheme: "light" });
      await light.addCookies([{ name: "site_appearance", value: "light", url: origin }]);
      const lightPage = await light.newPage();
      await lightPage.goto(origin);
      assert.equal(await lightPage.locator("body").evaluate((element) =>
        getComputedStyle(element).backgroundColor), "rgb(245, 237, 224)");
      await light.close();
    } finally {
      await browser.close();
    }

    process.kill(-application.pid, "SIGTERM");
    application = null;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    const keyFile = join(temporary, "billing.key");
    writeFileSync(keyFile, `${billingKey}\n`, { mode: 0o600 });
    const backup = join(temporary, "backup");
    const restored = join(temporary, "restored");
    expectSuccess(npm(starter, ["run", "ops:backup", "--", "--output", backup,
      "--key-file", keyFile], env), "back up BOROUGH data and media");
    expectSuccess(npm(starter, ["run", "ops:restore", "--", "--backup", backup,
      "--target", restored], env), "restore BOROUGH data and media");
    for (const { id } of mediaRows) {
      assert.ok(existsSync(join(restored, "media", `${id}.webp`)),
        `BOROUGH restore lost seeded media: ${id}`);
    }

    expectSuccess(addon(starter, ["remove", "borough-city-guide"]), "remove BOROUGH archive");
    const retained = new Database(databasePath, { readonly: true });
    try {
      assert.equal(retained.prepare("SELECT COUNT(*) FROM listings").pluck().get(),
        seed.listings.length, "BOROUGH removal deleted seeded listings");
      assert.equal(retained.prepare("SELECT COUNT(*) FROM media_assets").pluck().get(),
        imageSources.length, "BOROUGH removal deleted seeded media records");
    } finally {
      retained.close();
    }
    for (const { id } of mediaRows) {
      assert.ok(existsSync(join(mediaDirectory, `${id}.webp`)),
        `BOROUGH removal deleted seeded media file: ${id}`);
    }
    const fallback = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const imported = await import("./src/lib/theme-selection.ts");
        const api = imported.default ?? imported;
        const selected = api.getThemeSelection();
        if (selected.themeId !== "preset" || selected.templateId !== "classic") process.exit(2);`],
      { cwd: starter, encoding: "utf8",
        env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(fallback, "fallback after BOROUGH removal");
    assert.deepEqual(treeSnapshot(starter), baseline,
      "BOROUGH remove did not restore the unchanged starter source");
  } finally {
    if (application?.pid) {
      try { process.kill(-application.pid, "SIGTERM"); } catch { /* already stopped */ }
    }
    rmSync(temporary, { recursive: true, force: true });
  }
});

requirementTest("TPL-004 packages the complete NOW/NEXT events directory product", async () => {
  const fixture = join(repository, "fixtures/addons/now-next-events");
  assert.ok(existsSync(join(fixture, "directory-addon.json")),
    "the NOW/NEXT add-on package is missing");
  for (const path of [
    "src/theme.ts", "src/template.tsx", "src/template.css", "src/events.profile.json",
    "seed/catalog.json", "docs/readme.md", "docs/changelog.md", "docs/license.md",
  ]) assert.ok(existsSync(join(fixture, path)), `NOW/NEXT is missing ${path}`);

  const design = ["src/theme.ts", "src/template.css"]
    .map((path) => readFileSync(join(fixture, path), "utf8")).join("\n").toUpperCase();
  for (const token of ["#F5EEDF", "#FFF9EC", "#171A17", "#F05A2D", "#E9E8B9"]) {
    assert.match(design, new RegExp(token), `NOW/NEXT is missing ${token}`);
  }
  assert.match(design, /0PX|SQUARE/, "NOW/NEXT does not preserve square geometry");

  const profile = JSON.parse(readFileSync(join(fixture, "src/events.profile.json"), "utf8"));
  assert.equal(profile.id, "now-next-events.events");
  assert.equal(profile.version, "1.0.0");
  const fieldBySuffix = new Map(profile.fields.map((field) =>
    [field.key.replace("now-next-events.events.", ""), field]));
  const expectedFields = new Map([
    ["event-type", "single-choice"], ["topics", "multiple-choice"],
    ["attendance-mode", "single-choice"], ["starts-at", "datetime"],
    ["ends-at", "datetime"], ["time-zone", "short-text"],
    ["venue", "short-text"], ["location", "location"],
    ["price", "money"], ["ticket-url", "url"],
    ["accessibility", "multiple-choice"], ["speakers", "group"],
    ["schedule", "group"], ["event-media", "media"],
  ]);
  for (const [name, type] of expectedFields) {
    assert.equal(fieldBySuffix.get(name)?.type, type, `NOW/NEXT profile is missing ${name}`);
  }
  assert.ok(fieldBySuffix.get("starts-at")?.facet,
    "NOW/NEXT start time is not a public range facet");
  assert.ok(fieldBySuffix.get("starts-at")?.sort,
    "NOW/NEXT start time is not chronologically sortable");
    assert.ok(fieldBySuffix.get("speakers")?.constraints.children.some(({ key: childKey, type }) =>
      childKey === "portrait" && type === "media"),
    "NOW/NEXT speakers do not define public portrait media");

  const seed = JSON.parse(readFileSync(join(fixture, "seed/catalog.json"), "utf8"));
  assert.ok(seed.listings.length >= 10,
    "NOW/NEXT needs representative event and eligibility states");
  assert.ok(seed.listings.some(({ status }) => status !== "published"),
    "NOW/NEXT seed does not exercise an ineligible event");
  const values = seed.listings.map(({ profileValues }) => profileValues);
  const key = (suffix) => `now-next-events.events.${suffix}`;
  for (const mode of ["in-person", "online", "hybrid"]) {
    assert.ok(values.some((entry) => entry[key("attendance-mode")] === mode),
      `NOW/NEXT seed does not exercise ${mode} attendance`);
  }
  assert.ok(values.some((entry) => entry[key("price")]?.amountMinor === 0),
    "NOW/NEXT seed does not exercise a free event");
  assert.ok(values.some((entry) => entry[key("price")]?.amountMinor > 0),
    "NOW/NEXT seed does not exercise a paid event");
  assert.ok(values.every((entry) => typeof entry[key("time-zone")] === "string"),
    "NOW/NEXT seed omits event time zones");

  const source = readFileSync(join(fixture, "src/template.tsx"), "utf8");
  for (const behavior of [
    /All Dates/i, /Today/i, /This Week/i, /attendance-mode/i,
    /data-now-next-state/i, /Schedule/i, /Speakers/i,
  ]) assert.match(source, behavior, `NOW/NEXT renderer omits ${behavior}`);
  assert.doesNotMatch(source, /verified attendee|book(?:ing)? confirmed/i,
    "NOW/NEXT implies booking or attendee verification");

  const publishedSeed = seed.listings.filter(({ status }) => status === "published");
  assert.ok(publishedSeed.length > 12, "NOW/NEXT needs enough public events to exercise pagination");
  const imageSources = seed.listings.flatMap(({ media = [] }) => media.map(({ source }) => source));
  assert.ok(imageSources.length >= 10, "NOW/NEXT needs a representative event media set");
    const portraitMedia = seed.listings.flatMap(({ media = [] }) => media)
      .filter(({ childKey }) => childKey === "portrait");
    assert.deepEqual(portraitMedia.map(({ groupItemId }) => groupItemId).sort(),
      ["idris-bell", "mara-chen"], "NOW/NEXT does not package portraits for its seeded speakers");
  assert.equal(new Set(imageSources).size, imageSources.length,
    "NOW/NEXT seed reuses a packaged media identity");
  const manifest = JSON.parse(readFileSync(join(fixture, "directory-addon.json"), "utf8"));
  const brandAsset = "public/now-next-mark.svg";
  assert.ok(manifest.assets.includes(brandAsset), "NOW/NEXT does not declare its brand mark");
  assert.ok(manifest.files.includes(brandAsset), "NOW/NEXT brand mark is not package owned");
  assert.match(readFileSync(join(fixture, brandAsset), "utf8"), /<svg[\s>]/i);
  for (const mediaSource of imageSources) {
    assert.match(mediaSource, /^seed\/media\/[a-z0-9][a-z0-9._-]*$/,
      `unsafe NOW/NEXT seed media path: ${mediaSource}`);
    assert.ok(manifest.files.includes(mediaSource), `NOW/NEXT media is undeclared: ${mediaSource}`);
    assert.ok(readFileSync(join(fixture, mediaSource)).length > 1_024,
      `NOW/NEXT media is empty or implausibly small: ${mediaSource}`);
  }
  const imageDigests = imageSources.map((mediaSource) =>
    createHash("sha256").update(readFileSync(join(fixture, mediaSource))).digest("hex"));
  assert.equal(new Set(imageDigests).size, imageDigests.length,
    "NOW/NEXT repeats the same image under different names");

  const referenceTime = Date.parse("2026-10-15T16:00:00Z");
  const phase = (entry) => {
    const start = Date.parse(entry.profileValues[key("starts-at")]);
    const end = Date.parse(entry.profileValues[key("ends-at")]);
    return referenceTime < start ? "upcoming" : referenceTime < end ? "in-progress" : "past";
  };
  for (const expected of ["upcoming", "in-progress", "past"]) {
    assert.ok(publishedSeed.some((entry) => phase(entry) === expected),
      `NOW/NEXT seed does not exercise ${expected} events`);
  }
  assert.ok(publishedSeed.some((entry) =>
    Date.parse(entry.profileValues[key("ends-at")]) - Date.parse(entry.profileValues[key("starts-at")]) >
      86_400_000), "NOW/NEXT seed does not exercise a multi-day event");
  assert.ok(publishedSeed.every((entry) => entry.profileValues[key("speakers")].length >= 1 &&
    entry.profileValues[key("speakers")].length <= 8), "NOW/NEXT speaker rosters are not bounded");
  assert.ok(publishedSeed.every((entry) => entry.profileValues[key("schedule")].length >= 1 &&
    entry.profileValues[key("schedule")].length <= 16), "NOW/NEXT schedules are not bounded");

  const temporary = mkdtempSync(join(tmpdir(), "now-next-template-product-"));
  let application;
  const addon = (cwd, args) => spawnSync(process.execPath, ["scripts/addons.mjs", ...args], {
    cwd, encoding: "utf8", timeout: 300_000, env: { ...process.env, CI: "1" },
  });
  const npm = (cwd, args, env, timeout = 600_000) => spawnSync("npm", args, {
    cwd, encoding: "utf8", timeout, env: { ...process.env, CI: "1", ...env },
  });
  const expectSuccess = (result, label) => assert.equal(result.status, 0,
    `${label}: ${result.stderr || result.stdout}`);
  try {
    const firstArchive = join(temporary, "now-next-first.zip");
    const secondArchive = join(temporary, "now-next-second.zip");
    expectSuccess(addon(repository, ["pack", fixture, firstArchive]), "pack NOW/NEXT archive");
    expectSuccess(addon(repository, ["pack", fixture, secondArchive]), "repack NOW/NEXT archive");
    assert.deepEqual(readFileSync(firstArchive), readFileSync(secondArchive),
      "equal NOW/NEXT sources did not produce a byte-identical archive");
    expectSuccess(addon(repository, ["validate", firstArchive]), "validate NOW/NEXT archive");

    const corrupt = join(temporary, "corrupt-source");
    cpSync(fixture, corrupt, { recursive: true });
    writeFileSync(join(corrupt, imageSources[0]), "not an image");
    const corruptResult = addon(repository, ["pack", corrupt, join(temporary, "corrupt.zip")]);
    assert.notEqual(corruptResult.status, 0, "corrupt NOW/NEXT media unexpectedly packed");
    assert.match(corruptResult.stderr, /image|media|photograph/i);

    const escaping = join(temporary, "escaping-source");
    cpSync(fixture, escaping, { recursive: true });
    const escapingSeedPath = join(escaping, "seed/catalog.json");
    const escapingSeed = JSON.parse(readFileSync(escapingSeedPath, "utf8"));
    escapingSeed.listings[0].media[0].source = "seed/media/../outside.webp";
    writeFileSync(escapingSeedPath, `${JSON.stringify(escapingSeed, null, 2)}\n`);
    const escapingResult = addon(repository,
      ["pack", escaping, join(temporary, "escaping.zip")]);
    assert.notEqual(escapingResult.status, 0, "path-escaping NOW/NEXT media unexpectedly packed");
    assert.match(escapingResult.stderr, /path|media|unsafe/i);

    const starter = join(temporary, "starter");
    copyStarter(starter);
    const baseline = treeSnapshot(starter);
    const databasePath = join(temporary, `now-next-${randomBytes(6).toString("hex")}.db`);
    const mediaDirectory = join(dirname(databasePath), "media");
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const billingKey = randomBytes(32).toString("base64url");
    const env = {
      DATABASE_URL: `file:${databasePath}`,
      DIRECTORY_EXPLICIT_MIGRATIONS: "1",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BILLING_ENCRYPTION_KEY: billingKey,
      BILLING_CHECKOUT_MODE: "test",
      SITE_URL: origin,
      BETTER_AUTH_URL: origin,
    };
    assert.equal(existsSync(databasePath), false);
    expectSuccess(addon(starter, ["install", firstArchive]), "install NOW/NEXT archive");
    assert.equal(existsSync(databasePath), false, "NOW/NEXT installation opened the operator database");
    assert.equal(existsSync(mediaDirectory), false, "NOW/NEXT installation wrote runtime media");
    expectSuccess(npm(starter, ["run", "db:migrate"], env), "migrate NOW/NEXT database");
    expectSuccess(npm(starter, ["run", "build"], env), "build installed NOW/NEXT product");

    const activate = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const profilesModule = await import("./src/lib/directory-profiles.ts");
        const databaseModule = await import("./src/lib/database.ts");
        const themeModule = await import("./src/lib/theme-selection.ts");
        const profiles = profilesModule.default ?? profilesModule;
        const database = databaseModule.database ?? databaseModule.default?.database;
        const themes = themeModule.default ?? themeModule;
        const now = new Date().toISOString();
        database.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run("now-next-admin", "NOW/NEXT Admin", "now-next-admin@example.invalid", 1,
            now, now, "admin", 0);
        const definition = profiles.availableDirectoryProfileDefinition(
          "now-next-events.events", "1.0.0");
        profiles.activateDirectoryProfile({ definition, sourceKind: "addon",
          sourceId: "now-next-events", expectedRevision: 0,
          actorUserId: "now-next-admin" });
        const selected = themes.saveThemeSelection({ themeId: "now-next-events",
          templateId: "now-next-events" }, "now-next-admin");
        if (selected.templateId !== "now-next-events") process.exit(2);`],
      { cwd: starter, encoding: "utf8",
        env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(activate, "activate and select NOW/NEXT");

    const failureDb = new Database(databasePath);
    try {
      failureDb.exec(`CREATE TRIGGER reject_now_next_media BEFORE INSERT ON media_assets
        BEGIN SELECT RAISE(ABORT, 'deliberate NOW/NEXT media failure'); END`);
    } finally {
      failureDb.close();
    }
    const mediaBeforeFailure = existsSync(mediaDirectory) ? readdirSync(mediaDirectory).sort() : [];
    const failedSeed = npm(starter, ["run", "addon:seed", "--", "now-next-events"], env);
    assert.notEqual(failedSeed.status, 0, "NOW/NEXT seed ignored a media transaction failure");
    const afterFailureDb = new Database(databasePath);
    try {
      assert.equal(afterFailureDb.prepare("SELECT COUNT(*) FROM listings").pluck().get(), 0,
        "failed NOW/NEXT seed left listings behind");
      assert.equal(afterFailureDb.prepare("SELECT COUNT(*) FROM media_assets").pluck().get(), 0,
        "failed NOW/NEXT seed left media records behind");
      assert.equal(afterFailureDb.prepare("SELECT COUNT(*) FROM directory_profile_seed_runs")
        .pluck().get(), 0, "failed NOW/NEXT seed was recorded as complete");
      afterFailureDb.exec("DROP TRIGGER reject_now_next_media");
    } finally {
      afterFailureDb.close();
    }
    assert.deepEqual(existsSync(mediaDirectory) ? readdirSync(mediaDirectory).sort() : [],
      mediaBeforeFailure, "failed NOW/NEXT seed left runtime media behind");

    expectSuccess(npm(starter, ["run", "addon:seed", "--", "now-next-events"], env),
      "seed NOW/NEXT catalogue and media");
    const seededDb = new Database(databasePath);
    let mediaRows;
    const featuredSlug = "form-function-forum";
    const runtimeNow = Date.now();
    const runtimeDates = new Map([
      ["after-dark-sessions", new Date(runtimeNow - 172_800_000).toISOString()],
      ["form-function-forum", new Date(runtimeNow - 129_600_000).toISOString()],
      ["signal-rooftop", new Date(runtimeNow + 86_400_000).toISOString()],
    ]);
      const runtimeEnds = new Map();
      const runtimeStart = (entry) => runtimeDates.get(entry.slug) ?? entry.profileValues[key("starts-at")];
    try {
      assert.equal(seededDb.prepare("SELECT COUNT(*) FROM listings").pluck().get(),
        seed.listings.length);
        mediaRows = seededDb.prepare(`SELECT a.id, a.target_slug, a.alt, p.field_key, p.item_id, p.state
        FROM media_assets a JOIN directory_profile_media p ON p.asset_id = a.id
        ORDER BY a.target_slug, a.id`).all();
      assert.equal(mediaRows.length, imageSources.length,
        "NOW/NEXT did not create one media record per packaged image");
      assert.equal(seededDb.prepare("SELECT COUNT(*) FROM directory_profile_media").pluck().get(),
        imageSources.length, "NOW/NEXT media is not assigned to profile values");
        assert.deepEqual(mediaRows.filter(({ field_key }) => field_key === key("speakers"))
          .map(({ item_id }) => item_id).sort(), ["idris-bell", "mara-chen"],
        "NOW/NEXT speaker portraits are not assigned to their group items");
      assert.equal(seededDb.prepare("SELECT COUNT(*) FROM directory_profile_seed_runs")
        .pluck().get(), 1);

      const updateDate = seededDb.prepare(`UPDATE directory_profile_values SET date_start = ?, updated_at = ?
        WHERE listing_slug = ? AND field_key = ? AND archived_at IS NULL`);
      for (const [slug, startsAt] of runtimeDates) {
        const endsAt = slug === "form-function-forum"
          ? new Date(runtimeNow + 129_600_000).toISOString()
          : slug === "signal-rooftop" ? new Date(runtimeNow + 93_600_000).toISOString()
            : new Date(runtimeNow - 86_400_000).toISOString();
        runtimeEnds.set(slug, endsAt);
        const updatedAt = new Date().toISOString();
        assert.equal(updateDate.run(startsAt, updatedAt, slug, key("starts-at")).changes, 1);
        assert.equal(updateDate.run(endsAt, updatedAt, slug, key("ends-at")).changes, 1);
      }

      const featuredStartsAt = new Date(runtimeNow - 60_000).toISOString();
      const featuredEndsAt = new Date(runtimeNow + 86_400_000).toISOString();
      seededDb.prepare(`INSERT INTO publishing_plans
        (key, name, description, mode, billing_mode, amount_minor, currency, duration_days,
          featured, enabled, updated_at)
        VALUES ('now-next-featured', 'Featured event', '', 'test', 'one-time',
          2500, 'usd', 1, 1, 1, ?)`).run(featuredStartsAt);
      seededDb.prepare(`INSERT INTO purchases
        (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
          plan_description, amount_minor, currency, duration_days, accepted_duration_days,
          featured, stripe_session_id, status, created_at, provider)
        VALUES ('now-next-featured-purchase', ?, 'now-next-admin', 'now-next-featured', 'test',
          'one-time', 'Featured event', '', 2500, 'usd', 1, 1, 1,
          'pending:now-next-featured-purchase', 'paid', ?, 'stripe')`)
        .run(featuredSlug, featuredStartsAt);
      seededDb.prepare(`INSERT INTO entitlements
        (purchase_id, listing_slug, starts_at, ends_at, featured, revoked_at)
        VALUES ('now-next-featured-purchase', ?, ?, ?, 1, NULL)`)
        .run(featuredSlug, featuredStartsAt, featuredEndsAt);
    } finally {
      seededDb.close();
    }
    for (const { id } of mediaRows) {
      assert.ok(existsSync(join(mediaDirectory, `${id}.webp`)),
        `seeded NOW/NEXT media file is missing: ${id}`);
    }
    expectSuccess(npm(starter, ["run", "addon:seed", "--", "now-next-events"], env),
      "repeat NOW/NEXT seed");
    const repeatedDb = new Database(databasePath, { readonly: true });
    try {
      assert.equal(repeatedDb.prepare("SELECT COUNT(*) FROM listings").pluck().get(),
        seed.listings.length, "repeated NOW/NEXT seed duplicated listings");
      assert.equal(repeatedDb.prepare("SELECT COUNT(*) FROM media_assets").pluck().get(),
        imageSources.length, "repeated NOW/NEXT seed duplicated media");
    } finally {
      repeatedDb.close();
    }

    application = spawn("npm", ["run", "start", "--", "-p", String(port)], {
      cwd: starter, env: { ...process.env, CI: "1", ...env }, detached: true, stdio: "ignore",
    });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).status < 500) {
          ready = true;
          break;
        }
      } catch { /* wait for the production server */ }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    assert.ok(ready, "installed NOW/NEXT production server did not start");
    const html = async (path) => {
      const response = await fetch(`${origin}${path}`);
      const body = await response.text();
      assert.equal(response.status, 200, `${path}: ${body}`);
      return body;
    };
    const results = (body) => [...body.matchAll(/data-now-next-result="([a-z0-9-]+)"/g)]
      .map((match) => match[1]);
    const publicSlugs = publishedSeed.map(({ slug }) => slug).sort();

    const home = await html("/");
    assert.match(home, /The calendar with a pulse\./);
    assert.match(home, /WHAT(?:&#x27;|')S/);
    assert.match(home, /\/addons\/now-next-events\/now-next-mark\.svg/,
      "NOW/NEXT does not render its installed namespaced brand mark");
    assert.match(home, />All Dates</);
    assert.match(home, />Today</);
    assert.match(home, />This Week</);
    assert.match(home, /data-now-next-state=/);
      assert.match(home, /data-now-next-attendance="hybrid">\s*Hybrid</,
        "NOW/NEXT lead event does not visibly identify its attendance mode");
    assert.doesNotMatch(home, /city-systems-closing/);
    assert.ok([...home.matchAll(/data-now-next-event=/g)].length <= 7,
      "NOW/NEXT home discovery is not bounded");
      const runtimeEnd = (entry) => runtimeEnds.get(entry.slug) ?? entry.profileValues[key("ends-at")];
      const expectedHome = publishedSeed.filter((entry) => Date.parse(runtimeEnd(entry)) >= runtimeNow)
        .sort((left, right) => Date.parse(runtimeStart(left)) - Date.parse(runtimeStart(right)) ||
          left.slug.localeCompare(right.slug)).slice(0, 6).map(({ slug }) => slug);
      const homeSlugs = [...new Set([...home.matchAll(/data-now-next-event="([a-z0-9-]+)"/g)]
        .map((match) => match[1]))];
      assert.deepEqual(homeSlugs, expectedHome,
        "NOW/NEXT home does not show the catalogue's actual next events in chronological order");
      const todayHref = [...home.matchAll(/href="([^"]+)"[^>]*>Today</g)]
        .map((match) => match[1].replaceAll("&amp;", "&"))[0];
      assert.ok(todayHref, "NOW/NEXT Today link is missing");
      const todayUrl = new URL(todayHref, origin);
      assert.ok(todayUrl.searchParams.has(`max.${key("starts-at")}`));
      assert.ok(todayUrl.searchParams.has(`min.${key("ends-at")}`));
      assert.ok(results(await html(`${todayUrl.pathname}${todayUrl.search}`))
        .includes("form-function-forum"),
      "NOW/NEXT Today omitted an in-progress event that started before the selected day");

    const directory = await html(`/listings?sort=${encodeURIComponent(`${key("starts-at")}:asc`)}`);
    const secondPage = await html(`/listings?sort=${encodeURIComponent(`${key("starts-at")}:asc`)}&page=2`);
    assert.deepEqual([...results(directory), ...results(secondPage)].sort(), publicSlugs);
    assert.doesNotMatch(`${directory}${secondPage}`, /city-systems-closing/);
      for (const mode of ["In Person", "Online", "Hybrid"]) {
        assert.match(`${directory}${secondPage}`, new RegExp(`data-now-next-attendance="${mode.toLowerCase().replace(" ", "-")}">\\s*${mode}`),
          `NOW/NEXT cards do not visibly identify ${mode} attendance`);
      }
    assert.match(`${directory}${secondPage}`, /src="\/media\/[0-9a-f-]{36}"/,
      "NOW/NEXT directory does not use eligible runtime event media");

    const featured = await html("/listings?q=Form%20%2F%20Function%20Forum");
    assert.match(featured, new RegExp(`data-now-next-featured="${featuredSlug}"`));
    assert.match(featured, /Featured placement/);

    const filtered = async (entries) => results(await html(`/listings?${new URLSearchParams(entries)}`));
    const firstEventType = publishedSeed[0].profileValues[key("event-type")];
    const expectedEventType = publishedSeed.filter(({ profileValues }) =>
      profileValues[key("event-type")] === firstEventType).map(({ slug }) => slug).sort();
    assert.deepEqual((await filtered([[`facet.${key("event-type")}`, firstEventType]])).sort(),
      expectedEventType);
    const expectedDesign = publishedSeed.filter(({ profileValues }) =>
      profileValues[key("topics")].includes("design")).map(({ slug }) => slug).sort();
    assert.deepEqual((await filtered([[`facet.${key("topics")}`, "design"]])).sort(), expectedDesign);
    const expectedOnline = publishedSeed.filter(({ profileValues }) =>
      profileValues[key("attendance-mode")] === "online").map(({ slug }) => slug).sort();
    assert.deepEqual((await filtered([[`facet.${key("attendance-mode")}`, "online"]])).sort(),
      expectedOnline);
    const expectedNewYork = publishedSeed.filter(({ profileValues }) => {
      const location = profileValues[key("location")];
      return location.countryCode === "US" && location.region === "NY" && location.locality === "New York";
    }).map(({ slug }) => slug).sort();
    assert.deepEqual((await filtered([[`facet.${key("location")}`, "US|NY|New York"]])).sort(),
      expectedNewYork);
    assert.deepEqual(await filtered([["q", "Material Futures Lab"]]), ["material-futures-lab"]);
    const signalStart = runtimeDates.get("signal-rooftop");
    assert.deepEqual(await filtered([
      [`min.${key("starts-at")}`, signalStart], [`max.${key("starts-at")}`, signalStart],
    ]), ["signal-rooftop"]);

    const expectedChronological = [...publishedSeed].sort((left, right) =>
      Date.parse(runtimeStart(left)) - Date.parse(runtimeStart(right)) || left.slug.localeCompare(right.slug))
      .slice(0, 12).map(({ slug }) => slug);
    assert.deepEqual(results(directory), expectedChronological);

    const minimum = "2020-01-01T00:00:00.000Z";
    const pagedBody = await html(`/listings?${new URLSearchParams([
      [`min.${key("starts-at")}`, minimum], ["sort", `${key("starts-at")}:asc`],
    ])}`);
    const nextHref = [...pagedBody.matchAll(/href="([^"]+)"/g)]
      .map((match) => match[1].replaceAll("&amp;", "&"))
      .find((href) => new URL(href, origin).searchParams.get("page") === "2");
    assert.ok(nextHref, "NOW/NEXT pagination did not expose a second filtered page");
    const nextUrl = new URL(nextHref, origin);
    assert.equal(nextUrl.searchParams.get(`min.${key("starts-at")}`), minimum);
    assert.equal(nextUrl.searchParams.get("sort"), `${key("starts-at")}:asc`);

    const inProgressDetail = await html("/listings/form-function-forum");
    assert.match(inProgressDetail, /data-now-next-state="in-progress"/);
    assert.match(inProgressDetail, /Schedule/);
    assert.match(inProgressDetail, /data-now-next-schedule=/);
    assert.match(inProgressDetail, /Speakers/);
    assert.match(inProgressDetail, /data-now-next-speaker=/);
      assert.equal([...inProgressDetail.matchAll(/data-now-next-speaker-portrait=/g)].length, 2,
        "NOW/NEXT did not render both public speaker portraits");
      assert.ok([...inProgressDetail.matchAll(/data-now-next-gallery-image=/g)].length >= 2,
        "NOW/NEXT did not render its complete event image gallery");
      assert.match(inProgressDetail,
        /href="https:\/\/formfunction\.example\/speakers\/mara-chen"[^>]*>Speaker profile/,
      "NOW/NEXT omitted a public speaker profile URL");
      assert.match(inProgressDetail, /Ticket details with organizer/);
    assert.doesNotMatch(inProgressDetail, /verified attendee|book(?:ing)? confirmed/i);
    assert.match(inProgressDetail, /application\/ld\+json/);
    assert.match(inProgressDetail,
      new RegExp(`<link rel="canonical" href="${origin}/listings/form-function-forum"`));
    assert.match(inProgressDetail, /property="og:title"/);
    const pastDetail = await html("/listings/after-dark-sessions");
    assert.match(pastDetail, /data-now-next-state="past"/);
      assert.match(pastDetail, /Ticket details with organizer/);
      assert.doesNotMatch(pastDetail, /Organizer archive/);
    const upcomingDetail = await html("/listings/signal-rooftop");
    assert.match(upcomingDetail, /data-now-next-state="upcoming"/);
    const markdown = await fetch(`${origin}/markdown/listings/form-function-forum`);
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /Form \/ Function Forum/);

    const liveEditDb = new Database(databasePath);
    try {
      liveEditDb.prepare("UPDATE listings SET name = ? WHERE slug = ?")
        .run("Operator-edited live forum", featuredSlug);
      assert.match(await html("/"), /Operator-edited live forum/,
        "NOW/NEXT home remained stale after an operator edit");
      const now = new Date().toISOString();
      liveEditDb.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run("now-next-banned-owner", "Banned owner", "now-next-banned@example.invalid", 1,
          now, now, "user", 1);
      liveEditDb.prepare("UPDATE listings SET owner_user_id = ? WHERE slug = ?")
        .run("now-next-banned-owner", featuredSlug);
      assert.doesNotMatch(await html("/"), /Operator-edited live forum/,
        "a banned owner's event leaked onto the NOW/NEXT home page");
      liveEditDb.prepare("UPDATE listings SET owner_user_id = NULL, name = ? WHERE slug = ?")
        .run("Form / Function Forum", featuredSlug);
      const mediaId = mediaRows.find(({ target_slug: slug }) => slug === featuredSlug).id;
      liveEditDb.prepare("UPDATE directory_profile_media SET state = 'draft' WHERE asset_id = ?")
        .run(mediaId);
      assert.doesNotMatch(await html(`/listings/${featuredSlug}`), new RegExp(`/media/${mediaId}`),
        "private event media leaked through NOW/NEXT");
      liveEditDb.prepare("UPDATE directory_profile_media SET state = 'public' WHERE asset_id = ?")
        .run(mediaId);
    } finally {
      liveEditDb.close();
    }

    const browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
      args: ["--no-sandbox"] });
    try {
      const narrow = await browser.newContext({ viewport: { width: 320, height: 900 },
        colorScheme: "dark", javaScriptEnabled: false });
      await narrow.addCookies([{ name: "site_appearance", value: "dark", url: origin }]);
      const page = await narrow.newPage();
      await page.goto(`${origin}/listings`);
      assert.equal(await page.locator("html").getAttribute("data-template"), "now-next-events");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <=
        document.documentElement.clientWidth), "NOW/NEXT overflows at 320 pixels");
      const background = await page.locator("body").evaluate((element) =>
        getComputedStyle(element).backgroundColor);
      const foreground = await page.locator("body").evaluate((element) =>
        getComputedStyle(element).color);
      assert.ok(contrastRatio(background, foreground) >= 4.5,
        `NOW/NEXT dark text contrast is too low: ${background} / ${foreground}`);
      const firstLink = page.locator("a").first();
      await firstLink.focus();
      assert.equal(await firstLink.evaluate((element) => element === document.activeElement), true,
        "NOW/NEXT navigation cannot receive keyboard focus");
      await narrow.close();

      const light = await browser.newContext({ viewport: { width: 1280, height: 900 },
        colorScheme: "light" });
      await light.addCookies([{ name: "site_appearance", value: "light", url: origin }]);
      const lightPage = await light.newPage();
      await lightPage.goto(origin);
      assert.equal(await lightPage.locator("body").evaluate((element) =>
        getComputedStyle(element).backgroundColor), "rgb(245, 238, 223)");
      await light.close();
    } finally {
      await browser.close();
    }

    process.kill(-application.pid, "SIGTERM");
    application = null;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    const keyFile = join(temporary, "billing.key");
    writeFileSync(keyFile, `${billingKey}\n`, { mode: 0o600 });
    const backup = join(temporary, "backup");
    const restored = join(temporary, "restored");
    expectSuccess(npm(starter, ["run", "ops:backup", "--", "--output", backup,
      "--key-file", keyFile], env), "back up NOW/NEXT data and media");
    expectSuccess(npm(starter, ["run", "ops:restore", "--", "--backup", backup,
      "--target", restored], env), "restore NOW/NEXT data and media");
    for (const { id } of mediaRows) {
      assert.ok(existsSync(join(restored, "media", `${id}.webp`)),
        `NOW/NEXT restore lost seeded media: ${id}`);
    }

    expectSuccess(addon(starter, ["remove", "now-next-events"]), "remove NOW/NEXT archive");
    const retained = new Database(databasePath, { readonly: true });
    try {
      assert.equal(retained.prepare("SELECT COUNT(*) FROM listings").pluck().get(),
        seed.listings.length, "NOW/NEXT removal deleted seeded listings");
      assert.equal(retained.prepare("SELECT COUNT(*) FROM media_assets").pluck().get(),
        imageSources.length, "NOW/NEXT removal deleted seeded media records");
    } finally {
      retained.close();
    }
    for (const { id } of mediaRows) {
      assert.ok(existsSync(join(mediaDirectory, `${id}.webp`)),
        `NOW/NEXT removal deleted seeded media file: ${id}`);
    }
    const fallback = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const imported = await import("./src/lib/theme-selection.ts");
        const api = imported.default ?? imported;
        const selected = api.getThemeSelection();
        if (selected.themeId !== "preset" || selected.templateId !== "classic") process.exit(2);`],
      { cwd: starter, encoding: "utf8",
        env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(fallback, "fallback after NOW/NEXT removal");
    assert.deepEqual(treeSnapshot(starter), baseline,
      "NOW/NEXT remove did not restore the unchanged starter source");
  } finally {
    if (application?.pid) {
      try { process.kill(-application.pid, "SIGTERM"); } catch { /* already stopped */ }
    }
    rmSync(temporary, { recursive: true, force: true });
  }
});
