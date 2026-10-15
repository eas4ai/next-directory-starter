import sharp from "sharp";

export const SEED_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const sourcePattern = /^seed\/media\/[a-z0-9][a-z0-9._-]*\.(?:jpe?g|png|webp)$/;
const fieldPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const expectedFormat = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp" };

function exactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseSeedMedia(media, listingIndex, mediaIndex) {
  if (!media || typeof media !== "object" || Array.isArray(media) ||
      !exactKeys(media, ["source", "field", "alt"]) ||
      typeof media.source !== "string" || !sourcePattern.test(media.source) ||
      typeof media.field !== "string" || !fieldPattern.test(media.field) ||
      typeof media.alt !== "string" || !media.alt.trim() || media.alt !== media.alt.trim() ||
      media.alt.length > 160) {
    throw new Error(`Invalid add-on seed media at listing ${listingIndex}, item ${mediaIndex}`);
  }
  return { listingIndex, mediaIndex, source: media.source, field: media.field, alt: media.alt };
}

function listingMediaDeclarations(listing, listingIndex) {
  if (!listing || typeof listing !== "object" || Array.isArray(listing) ||
      listing.media === undefined) return [];
  if (!Array.isArray(listing.media) || listing.media.length > 20) {
    throw new Error(`Invalid add-on seed media at listing index ${listingIndex}`);
  }
  return listing.media.map((media, mediaIndex) => parseSeedMedia(media, listingIndex, mediaIndex));
}

export function seedMediaDeclarations(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(input.listings)) {
    return [];
  }
  const declarations = [];
  const sources = new Set();
  for (const [listingIndex, listing] of input.listings.entries()) {
    for (const declaration of listingMediaDeclarations(listing, listingIndex)) {
      if (sources.has(declaration.source)) {
        throw new Error(`Duplicate add-on seed media source: ${declaration.source}`);
      }
      sources.add(declaration.source);
      declarations.push(declaration);
    }
  }
  return declarations;
}

export async function validatePackagedSeedMedia(manifest, files) {
  if (!manifest.seed) return [];
  const seedBytes = files.get(manifest.seed);
  let input;
  try { input = JSON.parse(seedBytes.toString("utf8")); }
  catch { throw new Error("Add-on seed is not valid JSON"); }
  const declarations = seedMediaDeclarations(input);
  for (const declaration of declarations) {
    const bytes = files.get(declaration.source);
    if (!bytes) throw new Error(`Add-on seed media is not declared: ${declaration.source}`);
    if (!bytes.length || bytes.length > SEED_IMAGE_MAX_BYTES) {
      throw new Error(`Add-on seed media exceeds the image size limit: ${declaration.source}`);
    }
    try {
      const metadata = await sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" }).metadata();
      const extension = declaration.source.split(".").at(-1);
      if (metadata.format !== expectedFormat[extension] || !metadata.width || !metadata.height ||
          metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) {
        throw new Error("invalid metadata");
      }
    } catch {
      throw new Error(`Invalid add-on seed image: ${declaration.source}`);
    }
  }
  return declarations;
}
