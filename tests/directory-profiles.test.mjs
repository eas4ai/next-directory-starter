import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseListing } from "../src/lib/catalog-input.ts";
import { parseManifest } from "../scripts/addons/manifest.mjs";

const repository = resolve(import.meta.dirname, "..");
const selectedRequirement = process.env.PROFILE_REQUIREMENT;

function requirementTest(name, body) {
  if (!selectedRequirement || name.startsWith(selectedRequirement)) test(name, body);
}

requirementTest("PRF-001 activates immutable versioned directory-profile definitions", async () => {
  const modulePath = join(repository, "src/lib/directory-profiles.ts");
  assert.ok(existsSync(modulePath),
    "directory-profile definition and lifecycle module is missing");
  const profiles = await import(modulePath);
  assert.equal(typeof profiles.parseDirectoryProfileDefinition, "function",
    "directory profiles do not expose schema validation");
  assert.equal(typeof profiles.activateDirectoryProfile, "function",
    "directory profiles do not expose transactional activation");
});

requirementTest("PRF-002 validates profile values with the complete listing revision", () => {
  const profileValues = {
    "reference-addon.ai-tools": {
      pricingModel: "usage-based",
    },
  };
  const listing = parseListing({
    slug: "profile-aware-listing",
    name: "Profile aware listing",
    summary: "A valid listing carrying typed profile values.",
    description: "The profile values must remain attached to this validated revision.",
    category: "Developer tools",
    url: "https://example.com/profile-aware-listing",
    status: "draft",
    revision: 1,
    profileValues,
  });
  assert.ok(listing, "the core listing fixture must remain valid");
  assert.deepEqual(listing.profileValues, profileValues,
    "server listing validation drops profile values from the revision");
});

requirementTest("PRF-003 parses bounded public profile facets and stable sorts", async () => {
  const modulePath = join(repository, "src/lib/profile-discovery.ts");
  assert.ok(existsSync(modulePath),
    "generic server-rendered profile discovery and facet support is missing");
  const discovery = await import(modulePath);
  assert.equal(typeof discovery.parseProfileDirectoryQuery, "function",
    "profile discovery does not expose bounded GET query validation");
  assert.equal(typeof discovery.searchProfileDirectory, "function",
    "profile discovery does not expose indexed facet and sort execution");
});

requirementTest("PRF-004 validates profile-bearing add-on manifests", () => {
  const fixture = join(repository, "fixtures/addons/reference-addon/directory-addon.json");
  const manifest = JSON.parse(readFileSync(fixture, "utf8"));
  manifest.profiles = [{
    id: "ai-tools",
    version: "1.0.0",
    schema: "src/ai-tools.profile.json",
  }];
  manifest.files.push("src/ai-tools.profile.json");
  const parsed = parseManifest(manifest);
  assert.deepEqual(parsed.profiles, manifest.profiles,
    "add-on validation does not preserve versioned profile declarations");
});
