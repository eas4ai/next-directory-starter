import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync,
  symlinkSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { chromium } from "playwright-core";

const repository = resolve(import.meta.dirname, "..");
const selectedRequirement = process.env.TEMPLATE_REQUIREMENT;
const ignoredCopyRoots = new Set([
  ".git", ".next", ".runtime", ".claude", ".gstack", ".superpowers", "node_modules",
]);

const products = [
  {
    requirement: "TPL-005", id: "northstar-experts", name: "NORTHSTAR",
    profileId: "northstar-experts.experts", schema: "experts.profile.json",
    mark: "northstar-mark.svg", tagline: "The right expertise, clearly found.",
    colors: ["#F7F3E9", "#FFFDF8", "#173049", "#173B5B", "#7F9F94"],
    lightBackground: "rgb(247, 243, 233)",
    fields: {
      specialties: "multiple-choice", sectors: "multiple-choice",
      "engagement-modes": "multiple-choice", "service-location": "location",
      "time-zone": "short-text", languages: "multiple-choice",
      "years-experience": "integer", rate: "money", availability: "single-choice",
      "next-available": "date", credentials: "group", "credential-reviewed": "boolean",
      "credential-reviewed-at": "date", "contact-url": "url", portraits: "media",
    },
    operatorFields: ["credential-reviewed", "credential-reviewed-at"],
    facet: "specialties", sort: "years-experience",
  },
  {
    requirement: "TPL-006", id: "form-agencies", name: "FORM",
    profileId: "form-agencies.studios", schema: "studios.profile.json",
    mark: "form-mark.svg", tagline: "Big work deserves a bigger stage.",
    colors: ["#F2EFE5", "#FFFDF8", "#171717", "#EE522E", "#E8EA50"],
    lightBackground: "rgb(242, 239, 229)",
    fields: {
      services: "multiple-choice", industries: "multiple-choice", headquarters: "location",
      "service-regions": "multiple-choice", "team-size": "single-choice",
      "minimum-budget": "money", "engagement-models": "multiple-choice",
      availability: "single-choice", "lead-time": "duration", "contact-url": "url",
      "case-studies": "group", "portfolio-media": "media",
    },
    groupMedia: { field: "case-studies", child: "media" },
    operatorFields: [], facet: "services", sort: "minimum-budget",
  },
  {
    requirement: "TPL-007", id: "stackfile-resources", name: "stackfile",
    profileId: "stackfile-resources.resources", schema: "resources.profile.json",
    mark: "stackfile-mark.svg", tagline: "Find the tool. Read the details.",
    colors: ["#151A1C", "#20282A", "#E5E9E0", "#B7D8A4", "#46534A"],
    lightBackground: "rgb(21, 26, 28)",
    fields: {
      "resource-type": "single-choice", languages: "multiple-choice",
      frameworks: "multiple-choice", runtimes: "multiple-choice", platforms: "multiple-choice",
      license: "single-choice", compatibility: "short-text", "current-version": "short-text",
      "last-release": "date", "install-command": "short-text", "documentation-url": "url",
      "repository-url": "url", "maintenance-status": "single-choice",
      "pricing-model": "single-choice", "open-source": "boolean", "last-reviewed": "date",
      "resource-media": "media",
    },
    narrowHomeFacts: [["strong", "type"], ["code", "version"],
      ["em", "compatibility"], ["b", "maintenance"]],
    operatorFields: ["last-reviewed"], facet: "resource-type", sort: "last-release",
  },
  {
    requirement: "TPL-008", id: "lessonpath-courses", name: "Lessonpath",
    profileId: "lessonpath-courses.courses", schema: "courses.profile.json",
    mark: "lessonpath-mark.svg", tagline: "A clearer route to what’s next.",
    colors: ["#F8F7ED", "#FFFFFF", "#24354E", "#EB6F50", "#8BBED0"],
    lightBackground: "rgb(248, 247, 237)",
    fields: {
      topics: "multiple-choice", level: "single-choice", format: "multiple-choice",
      duration: "duration", price: "money", pace: "single-choice",
      "schedule-model": "single-choice", language: "single-choice", certificate: "boolean",
      prerequisites: "group", "learning-outcomes": "group", provider: "short-text",
      instructors: "group", "enrollment-url": "url", "course-media": "media",
    },
    groupMedia: { field: "instructors", child: "portrait" },
    operatorFields: [], facet: "topics", sort: "duration",
  },
  {
    requirement: "TPL-009", id: "supper-restaurants", name: "Supper",
    profileId: "supper-restaurants.restaurants", schema: "restaurants.profile.json",
    mark: "supper-mark.svg", tagline: "Eat well. Know where.",
    colors: ["#F7F0E5", "#FFFAF1", "#2B3426", "#A52C27", "#6B7F4B"],
    lightBackground: "rgb(247, 240, 229)",
    fields: {
      cuisines: "multiple-choice", neighborhood: "single-choice", location: "location",
      "price-level": "single-choice", "typical-meal-price": "money",
      "dietary-options": "multiple-choice", "meal-periods": "multiple-choice",
      "service-modes": "multiple-choice", "reservation-url": "url", "time-zone": "short-text",
      "opening-hours": "group", "signature-dishes": "group",
      accessibility: "multiple-choice", "restaurant-media": "media",
    },
    operatorFields: [], facet: "cuisines", sort: "typical-meal-price",
  },
  {
    requirement: "TPL-010", id: "elsewhere-travel", name: "Elsewhere",
    profileId: "elsewhere-travel.experiences", schema: "experiences.profile.json",
    mark: "elsewhere-mark.svg", tagline: "Go where the day takes you.",
    colors: ["#EEF6F3", "#FFFFFF", "#173D4B", "#197E86", "#D5C6A6"],
    lightBackground: "rgb(238, 246, 243)",
    fields: {
      destination: "short-text", "meeting-location": "location",
      "experience-type": "single-choice", seasons: "multiple-choice",
      activities: "multiple-choice", duration: "duration", price: "money",
      "group-size": "integer", difficulty: "single-choice",
      accessibility: "multiple-choice", inclusions: "multiple-choice",
      "booking-url": "url", itinerary: "group", "travel-media": "media",
    },
    operatorFields: [], facet: "seasons", sort: "price",
  },
  {
    requirement: "TPL-011", id: "homekind-services", name: "Homekind",
    profileId: "homekind-services.providers", schema: "providers.profile.json",
    mark: "homekind-mark.svg", tagline: "Good help for the place you love.",
    colors: ["#F4F7F5", "#FFFFFF", "#1E3B3D", "#2A7770", "#8EB4A5"],
    lightBackground: "rgb(244, 247, 245)",
    fields: {
      services: "multiple-choice", "service-area": "multiple-choice",
      "base-location": "location", "pricing-model": "single-choice",
      "minimum-price": "money", "response-time": "duration", "emergency-service": "boolean",
      availability: "single-choice", "years-in-business": "integer", licenses: "group",
      insured: "boolean", "provider-reviewed": "boolean", "provider-reviewed-at": "date",
      "aggregate-rating": "decimal", "review-count": "integer", "review-source-url": "url",
      "quote-url": "url", accessibility: "multiple-choice", "work-media": "media",
    },
    operatorFields: ["provider-reviewed", "provider-reviewed-at", "aggregate-rating",
      "review-count", "review-source-url"],
    facet: "services", sort: "aggregate-rating",
  },
];

function requirementTest(name, body) {
  if (!selectedRequirement || name.startsWith(selectedRequirement)) test(name, body);
}

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

function comparable(value) {
  if (value && typeof value === "object" && "amountMinor" in value) return value.amountMinor;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

async function assertProduct(config) {
  const fixture = join(repository, "fixtures/addons", config.id);
  assert.ok(existsSync(join(fixture, "directory-addon.json")),
    `${config.name} add-on package is missing`);
  const requiredPaths = [
    "src/theme.ts", "src/template.tsx", "src/template.css", `src/${config.schema}`,
    "seed/catalog.json", "docs/readme.md", "docs/changelog.md", "docs/license.md",
    `public/${config.mark}`,
  ];
  for (const path of requiredPaths) {
    assert.ok(existsSync(join(fixture, path)), `${config.name} is missing ${path}`);
  }

  const design = ["src/theme.ts", "src/template.css"]
    .map((path) => readFileSync(join(fixture, path), "utf8")).join("\n").toUpperCase();
  for (const color of config.colors) {
    assert.match(design, new RegExp(color), `${config.name} is missing ${color}`);
  }
  assert.doesNotMatch(design, /TODO|PLACEHOLDER/i, `${config.name} contains unfinished design work`);

  const manifest = JSON.parse(readFileSync(join(fixture, "directory-addon.json"), "utf8"));
  assert.equal(manifest.id, config.id);
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.themes[0]?.id, config.id);
  assert.equal(manifest.templates[0]?.id, config.id);
  assert.equal(manifest.profiles[0]?.id, config.profileId);
  assert.equal(manifest.profiles[0]?.version, "1.0.0");
  assert.deepEqual(manifest.templates[0]?.supportedProfiles,
    [{ id: config.profileId, range: "^1.0.0" }]);
  const brandAsset = `public/${config.mark}`;
  assert.ok(manifest.assets.includes(brandAsset), `${config.name} does not declare its brand mark`);
  assert.ok(manifest.files.includes(brandAsset), `${config.name} does not own its brand mark`);
  assert.match(readFileSync(join(fixture, brandAsset), "utf8"), /<svg[\s>]/i);

  const profile = JSON.parse(readFileSync(join(fixture, "src", config.schema), "utf8"));
  assert.equal(profile.id, config.profileId);
  assert.equal(profile.version, "1.0.0");
  const fieldBySuffix = new Map(profile.fields.map((field) =>
    [field.key.replace(`${config.profileId}.`, ""), field]));
  for (const [suffix, type] of Object.entries(config.fields)) {
    assert.equal(fieldBySuffix.get(suffix)?.type, type,
      `${config.name} profile is missing ${suffix}:${type}`);
  }
  for (const suffix of config.operatorFields) {
    assert.equal(fieldBySuffix.get(suffix)?.writeAuthority, "operator",
      `${config.name} ${suffix} must be operator owned`);
  }
  assert.ok(fieldBySuffix.get(config.facet)?.facet, `${config.name} primary facet is missing`);
  assert.ok(fieldBySuffix.get(config.sort)?.sort, `${config.name} primary sort is missing`);

  const seed = JSON.parse(readFileSync(join(fixture, "seed/catalog.json"), "utf8"));
  assert.equal(seed.profile.id, config.profileId);
  assert.equal(seed.profile.version, "1.0.0");
  assert.ok(seed.listings.length >= 14,
    `${config.name} needs at least fourteen representative records`);
  const publishedSeed = seed.listings.filter(({ status }) => status === "published");
  assert.ok(publishedSeed.length >= 13,
    `${config.name} needs enough eligible records to exercise pagination`);
  assert.ok(seed.listings.some(({ status }) => status !== "published"),
    `${config.name} does not exercise an ineligible record`);
  const fieldKey = (suffix) => `${config.profileId}.${suffix}`;
  for (const suffix of Object.keys(config.fields)) {
    assert.ok(seed.listings.some(({ profileValues }) =>
      profileValues && Object.hasOwn(profileValues, fieldKey(suffix))),
    `${config.name} seed never exercises ${suffix}`);
  }
  if (config.id === "northstar-experts") {
    for (const listing of seed.listings) {
      const reviewed = listing.profileValues[fieldKey("credential-reviewed")];
      const reviewedAt = listing.profileValues[fieldKey("credential-reviewed-at")];
      assert.equal(Boolean(reviewedAt), reviewed === true,
        `${listing.slug} has contradictory credential review state and date`);
    }
  }
  if (config.groupMedia) {
    const groupKey = fieldKey(config.groupMedia.field);
    const group = fieldBySuffix.get(config.groupMedia.field);
    const mediaChild = group?.constraints.children.find(({ key }) => key === config.groupMedia.child);
    assert.equal(mediaChild?.type, "media",
      `${config.name} ${config.groupMedia.field} is missing its media child`);
    assert.equal(mediaChild?.required, true,
      `${config.name} ${config.groupMedia.child} must be required for every group item`);
    for (const listing of seed.listings) {
      const items = listing.profileValues[groupKey];
      assert.ok(Array.isArray(items), `${listing.slug} is missing ${config.groupMedia.field}`);
      for (const item of items) {
        assert.ok((listing.media ?? []).some((media) => media.field === groupKey &&
          media.groupItemId === item.id && media.childKey === config.groupMedia.child),
        `${listing.slug}/${item.id} is missing associated ${config.groupMedia.child} media`);
      }
    }
  }

  const imageSources = seed.listings.flatMap(({ media = [] }) => media.map(({ source }) => source));
  assert.ok(imageSources.length >= 8, `${config.name} needs a representative original media set`);
  assert.equal(new Set(imageSources).size, imageSources.length,
    `${config.name} reuses a packaged media identity`);
  for (const source of imageSources) {
    assert.match(source, /^seed\/media\/[a-z0-9][a-z0-9._-]*$/,
      `unsafe ${config.name} seed media path: ${source}`);
    assert.ok(manifest.files.includes(source), `${config.name} media is undeclared: ${source}`);
    assert.ok(readFileSync(join(fixture, source)).length > 1_024,
      `${config.name} media is empty or implausibly small: ${source}`);
  }
  const digests = imageSources.map((source) =>
    createHash("sha256").update(readFileSync(join(fixture, source))).digest("hex"));
  assert.equal(new Set(digests).size, digests.length,
    `${config.name} repeats the same image under different names`);

  const templateSource = readFileSync(join(fixture, "src/template.tsx"), "utf8");
  assert.match(templateSource, new RegExp(config.tagline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(templateSource, new RegExp(`data-template-product=["']${config.id}["']`));
  assert.match(templateSource, /data-template-result=/);
  assert.doesNotMatch(templateSource, /TODO|PLACEHOLDER|lorem ipsum/i,
    `${config.name} renderer contains unfinished content`);

  const temporary = mkdtempSync(join(tmpdir(), `${config.id}-product-`));
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
    const firstArchive = join(temporary, `${config.id}-first.zip`);
    const secondArchive = join(temporary, `${config.id}-second.zip`);
    expectSuccess(addon(repository, ["pack", fixture, firstArchive]), `pack ${config.name}`);
    expectSuccess(addon(repository, ["pack", fixture, secondArchive]), `repack ${config.name}`);
    assert.deepEqual(readFileSync(firstArchive), readFileSync(secondArchive),
      `${config.name} archives are not reproducible`);
    expectSuccess(addon(repository, ["validate", firstArchive]), `validate ${config.name}`);

    const starter = join(temporary, "starter");
    copyStarter(starter);
    const baseline = treeSnapshot(starter);
    const databasePath = join(temporary, `${config.id}-${randomBytes(6).toString("hex")}.db`);
    const mediaDirectory = join(dirname(databasePath), "media");
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const env = {
      DATABASE_URL: `file:${databasePath}`,
      DIRECTORY_EXPLICIT_MIGRATIONS: "1",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BILLING_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
      BILLING_CHECKOUT_MODE: "test",
      SITE_URL: origin,
      BETTER_AUTH_URL: origin,
    };
    expectSuccess(addon(starter, ["install", firstArchive]), `install ${config.name}`);
    assert.equal(existsSync(databasePath), false,
      `${config.name} installation opened the operator database`);
    assert.equal(existsSync(mediaDirectory), false,
      `${config.name} installation wrote runtime media`);
    expectSuccess(npm(starter, ["run", "db:migrate"], env), `migrate ${config.name}`);
    expectSuccess(npm(starter, ["run", "build"], env), `build ${config.name}`);

    const adminId = `${config.id}-admin`;
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
          .run(${JSON.stringify(adminId)}, ${JSON.stringify(`${config.name} Admin`)},
            ${JSON.stringify(`${adminId}@example.invalid`)}, 1, now, now, "admin", 0);
        const definition = profiles.availableDirectoryProfileDefinition(
          ${JSON.stringify(config.profileId)}, "1.0.0");
        profiles.activateDirectoryProfile({ definition, sourceKind: "addon",
          sourceId: ${JSON.stringify(config.id)}, expectedRevision: 0,
          actorUserId: ${JSON.stringify(adminId)} });
        const selected = themes.saveThemeSelection({ themeId: ${JSON.stringify(config.id)},
          templateId: ${JSON.stringify(config.id)} }, ${JSON.stringify(adminId)});
        if (selected.templateId !== ${JSON.stringify(config.id)}) process.exit(2);`],
      { cwd: starter, encoding: "utf8",
        env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(activate, `activate and select ${config.name}`);

    const failureDb = new Database(databasePath);
    try {
      failureDb.exec(`CREATE TRIGGER reject_series_media BEFORE INSERT ON media_assets
        BEGIN SELECT RAISE(ABORT, 'deliberate series media failure'); END`);
    } finally {
      failureDb.close();
    }
    const failedSeed = npm(starter, ["run", "addon:seed", "--", config.id], env);
    assert.notEqual(failedSeed.status, 0, `${config.name} seed ignored a media failure`);
    const failedDb = new Database(databasePath);
    try {
      assert.equal(failedDb.prepare("SELECT COUNT(*) FROM listings").pluck().get(), 0,
        `failed ${config.name} seed left listings behind`);
      assert.equal(failedDb.prepare("SELECT COUNT(*) FROM media_assets").pluck().get(), 0,
        `failed ${config.name} seed left media behind`);
      failedDb.exec("DROP TRIGGER reject_series_media");
    } finally {
      failedDb.close();
    }
    assert.equal(existsSync(mediaDirectory) ? readdirSync(mediaDirectory).length : 0, 0,
      `failed ${config.name} seed left runtime files behind`);

    expectSuccess(npm(starter, ["run", "addon:seed", "--", config.id], env),
      `seed ${config.name}`);
    const seededDb = new Database(databasePath, { readonly: true });
    let mediaRows;
    try {
      assert.equal(seededDb.prepare("SELECT COUNT(*) FROM listings").pluck().get(),
        seed.listings.length);
      mediaRows = seededDb.prepare("SELECT id FROM media_assets ORDER BY id").all();
      assert.equal(mediaRows.length, imageSources.length,
        `${config.name} did not create one runtime asset per packaged image`);
      assert.equal(seededDb.prepare("SELECT COUNT(*) FROM directory_profile_seed_runs")
        .pluck().get(), 1);
    } finally {
      seededDb.close();
    }
    for (const { id } of mediaRows) {
      assert.ok(existsSync(join(mediaDirectory, `${id}.webp`)),
        `${config.name} runtime media is missing: ${id}`);
    }
    expectSuccess(npm(starter, ["run", "addon:seed", "--", config.id], env),
      `repeat ${config.name} seed`);
    const repeatedDb = new Database(databasePath, { readonly: true });
    try {
      assert.equal(repeatedDb.prepare("SELECT COUNT(*) FROM listings").pluck().get(),
        seed.listings.length, `${config.name} repeated seed duplicated listings`);
      assert.equal(repeatedDb.prepare("SELECT COUNT(*) FROM media_assets").pluck().get(),
        imageSources.length, `${config.name} repeated seed duplicated media`);
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
    assert.ok(ready, `${config.name} production server did not start`);
    const html = async (path) => {
      const response = await fetch(`${origin}${path}`);
      const body = await response.text();
      assert.equal(response.status, 200, `${path}: ${body}`);
      return body;
    };
    const results = (body) => [...body.matchAll(/data-template-result="([a-z0-9-]+)"/g)]
      .map((match) => match[1]);
    const resultPages = async (entries = []) => {
      const found = [];
      for (let page = 1; page <= 3; page += 1) {
        const query = new URLSearchParams([...entries, ["page", String(page)]]);
        const pageResults = results(await html(`/listings?${query}`));
        found.push(...pageResults);
        if (pageResults.length < 12) break;
      }
      return found;
    };

    const home = await html("/");
    assert.match(home, new RegExp(config.tagline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(home, new RegExp(`/addons/${config.id}/${config.mark.replace(".svg", "\\.svg")}`));
    const publicSlugs = publishedSeed.map(({ slug }) => slug).sort();
    assert.deepEqual((await resultPages()).sort(), publicSlugs,
      `${config.name} directory eligibility or pagination is wrong`);
    const hidden = seed.listings.find(({ status }) => status !== "published");
    assert.doesNotMatch(home, new RegExp(hidden.slug));

    const facetValue = publishedSeed[0].profileValues[fieldKey(config.facet)];
    const selectedFacet = Array.isArray(facetValue) ? facetValue[0] : facetValue;
    const expectedFacet = publishedSeed.filter(({ profileValues }) => {
      const value = profileValues[fieldKey(config.facet)];
      return Array.isArray(value) ? value.includes(selectedFacet) : value === selectedFacet;
    }).map(({ slug }) => slug).sort();
    assert.deepEqual((await resultPages([[`facet.${fieldKey(config.facet)}`,
      String(selectedFacet)]])).sort(), expectedFacet,
    `${config.name} primary facet returns the wrong records`);

    const expectedSort = [...publishedSeed].sort((left, right) => {
      const leftValue = comparable(left.profileValues[fieldKey(config.sort)]);
      const rightValue = comparable(right.profileValues[fieldKey(config.sort)]);
      const valueOrder = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue));
      return valueOrder || left.title.localeCompare(right.title);
    }).map(({ slug }) => slug);
    assert.deepEqual(await resultPages([["sort", `${fieldKey(config.sort)}:asc`]]), expectedSort,
      `${config.name} primary sort returns the wrong order`);

    const first = publishedSeed[0];
    const detail = await html(`/listings/${first.slug}`);
    assert.match(detail, new RegExp(first.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(detail, /application\/ld\+json/);
    assert.match(detail,
      new RegExp(`<link rel="canonical" href="${origin}/listings/${first.slug}"`));
    const markdown = await fetch(`${origin}/markdown/listings/${first.slug}`);
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), new RegExp(first.title));
    const social = await fetch(`${origin}/og/listings/${first.slug}.png`);
    assert.equal(social.status, 200, `${config.name} social card failed`);
    assert.match(social.headers.get("content-type") ?? "", /^image\//);

    const browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
      args: ["--no-sandbox"] });
    try {
      const narrow = await browser.newContext({ viewport: { width: 320, height: 900 },
        colorScheme: "dark", javaScriptEnabled: false });
      await narrow.addCookies([{ name: "site_appearance", value: "dark", url: origin }]);
      const page = await narrow.newPage();
      await page.goto(`${origin}/listings`);
      assert.equal(await page.locator("html").getAttribute("data-template"), config.id);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <=
        document.documentElement.clientWidth), `${config.name} overflows at 320 pixels`);
      const background = await page.locator("body").evaluate((element) =>
        getComputedStyle(element).backgroundColor);
      const foreground = await page.locator("body").evaluate((element) =>
        getComputedStyle(element).color);
      assert.ok(contrastRatio(background, foreground) >= 4.5,
        `${config.name} dark contrast is too low: ${background} / ${foreground}`);
      const firstLink = page.locator("a").first();
      await firstLink.focus();
      assert.equal(await firstLink.evaluate((element) => element === document.activeElement), true,
        `${config.name} navigation cannot receive focus`);
      if (config.narrowHomeFacts) {
        await page.goto(origin);
        const firstRow = page.locator(".stackfile-table > article").first();
        for (const [selector, expectedLabel] of config.narrowHomeFacts) {
          const fact = firstRow.locator(`:scope > ${selector}`);
          assert.equal(await fact.isVisible(), true,
            `${config.name} hides ${expectedLabel} on its narrow home table`);
          const label = await fact.evaluate((element) =>
            getComputedStyle(element, "::before").content.replaceAll('"', ""));
          assert.equal(label, expectedLabel,
            `${config.name} does not label ${expectedLabel} on its narrow home table`);
        }
      }
      await narrow.close();

      const light = await browser.newContext({ viewport: { width: 1280, height: 900 },
        colorScheme: "light" });
      await light.addCookies([{ name: "site_appearance", value: "light", url: origin }]);
      const lightPage = await light.newPage();
      await lightPage.goto(origin);
      assert.equal(await lightPage.locator("body").evaluate((element) =>
        getComputedStyle(element).backgroundColor), config.lightBackground);
      await light.close();
    } finally {
      await browser.close();
    }

    process.kill(-application.pid, "SIGTERM");
    application = null;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    expectSuccess(addon(starter, ["remove", config.id]), `remove ${config.name}`);
    const retained = new Database(databasePath, { readonly: true });
    try {
      assert.equal(retained.prepare("SELECT COUNT(*) FROM listings").pluck().get(),
        seed.listings.length, `${config.name} removal deleted seeded listings`);
      assert.equal(retained.prepare("SELECT COUNT(*) FROM media_assets").pluck().get(),
        imageSources.length, `${config.name} removal deleted seeded media`);
    } finally {
      retained.close();
    }
    for (const { id } of mediaRows) {
      assert.ok(existsSync(join(mediaDirectory, `${id}.webp`)),
        `${config.name} removal deleted runtime media: ${id}`);
    }
    const fallback = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `
        const imported = await import("./src/lib/theme-selection.ts");
        const api = imported.default ?? imported;
        const selected = api.getThemeSelection();
        if (selected.themeId !== "preset" || selected.templateId !== "classic") process.exit(2);`],
      { cwd: starter, encoding: "utf8",
        env: { ...process.env, CI: "1", NODE_ENV: "test", ...env } });
    expectSuccess(fallback, `fallback after ${config.name} removal`);
    assert.deepEqual(treeSnapshot(starter), baseline,
      `${config.name} removal did not restore unchanged starter source`);
  } finally {
    if (application?.pid) {
      try { process.kill(-application.pid, "SIGTERM"); } catch { /* already stopped */ }
    }
    rmSync(temporary, { recursive: true, force: true });
  }
}

for (const product of products) {
  requirementTest(`${product.requirement} packages the complete ${product.name} directory product`,
    async () => assertProduct(product));
}
