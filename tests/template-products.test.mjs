import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
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
        const databaseModule = await import("./src/lib/database.ts");
        const themeModule = await import("./src/lib/theme-selection.ts");
        const profiles = profilesModule.default ?? profilesModule;
        const database = databaseModule.database ?? databaseModule.default?.database;
        const themes = themeModule.default ?? themeModule;
        const now = new Date().toISOString();
        database.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run("vector-admin", "VECTOR Admin", "vector-admin@example.invalid", 1,
            now, now, "admin", 0);
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

    assert.match(await html("/"), /Discover tools that/);
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
