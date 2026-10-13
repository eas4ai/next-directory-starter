import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { getSiteConfig } from "@/lib/site-config";
import { mediaFilePath } from "@/lib/media";
import { getThemePreset } from "@/lib/theme";
import { getThemeSelection } from "@/lib/theme-selection";
import { socialPaletteForSelection } from "@/lib/theme-sdk";
import { SocialCardRenderCache, socialCardRevision,
  type SocialCardCacheOptions, type SocialCardRenderResult } from "@/lib/social-card-cache";

migrateCatalog();

type CardRow = { name: string; summary: string; category: string;
  revision: number; screenshot_bytes: Buffer | null };
type CardSnapshot = {
  row: CardRow;
  brand: ReturnType<typeof getSiteConfig>;
  palette: ReturnType<typeof socialPaletteForSelection>;
  revision: string;
};

export type RenderedImportCard = { bytes: Buffer; revision: string };

const cacheOptions: SocialCardCacheOptions = {
  maxEntries: 32,
  maxBytes: 16 * 1024 * 1024,
  maxConcurrent: 2,
  maxWaiting: 16,
};
const cardCache = new SocialCardRenderCache(cacheOptions);

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function lines(value: string, width: number, count: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const output: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && `${current} ${word}`.length > width) {
      output.push(current);
      current = word;
      if (output.length === count) break;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (output.length < count && current) output.push(current);
  return output.map((line) => escapeXml(line.slice(0, width + 8)));
}

function textLines(parts: string[], x: number, start: number, step: number): string {
  return parts.map((part, index) => `<text x="${x}" y="${start + index * step}">${part}</text>`).join("");
}

function cardSnapshot(slug: string, includeDraft: boolean): CardSnapshot | null {
  const row = database.prepare(`SELECT l.name, l.summary, l.category, l.revision, i.screenshot_bytes
    FROM agent_imports i JOIN listings l ON l.slug = i.slug WHERE i.slug = ?
      ${includeDraft ? "" : `AND l.status = 'published' AND NOT EXISTS (
        SELECT 1 FROM "user" owner WHERE owner.id = l.owner_user_id AND owner.banned = 1
      )`}`)
    .get(slug) as CardRow | undefined;
  if (!row) return null;
  const brand = getSiteConfig();
  const selection = getThemeSelection();
  const palette = socialPaletteForSelection(getThemePreset(), selection.themeId);
  const screenshot = includeDraft && row.screenshot_bytes
    ? createHash("sha256").update(row.screenshot_bytes).digest("hex")
    : Boolean(row.screenshot_bytes);
  return {
    row,
    brand,
    palette,
    revision: socialCardRevision(`import:${includeDraft ? "preview" : "public"}:${slug}`, {
      content: { name: row.name, summary: row.summary, category: row.category,
        revision: row.revision, screenshot },
      branding: brand,
      theme: { selection, palette },
    }),
  };
}

async function renderSnapshot({ row, brand, palette }: CardSnapshot): Promise<SocialCardRenderResult> {
  const withScreenshot = Boolean(row.screenshot_bytes);
  const siteName = escapeXml(brand.name.slice(0, 42));
  const heading = lines(row.name, withScreenshot ? 24 : 42, 3);
  const summary = lines(row.summary, withScreenshot ? 38 : 74, 3);
  const category = escapeXml(row.category.slice(0, 80));
  const textWidth = withScreenshot ? 620 : 1070;
  const logoId = /^\/brand-assets\/([0-9a-f-]{36})\.webp$/.exec(brand.logoUrl ?? "")?.[1];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="${palette.background}"/><stop offset="1" stop-color="${palette.accent}" stop-opacity="0.4"/>
    </linearGradient></defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <rect x="48" y="48" width="1104" height="534" rx="28" fill="${palette.foreground}" fill-opacity="0.06" stroke="${palette.foreground}" stroke-opacity="0.2"/>
    <rect x="80" y="88" width="9" height="38" rx="4" fill="${palette.accent}"/>
    <g fill="${palette.foreground}" font-family="sans-serif" font-size="24" font-weight="600"><text x="105" y="116">${siteName}</text></g>
    <g fill="${palette.accent}" font-family="sans-serif" font-size="20" font-weight="600"><text x="80" y="182">${category.toUpperCase()}</text></g>
    <g fill="${palette.foreground}" font-family="sans-serif" font-size="${withScreenshot ? 48 : 60}" font-weight="700">${textLines(heading, 80, 255, withScreenshot ? 58 : 72)}</g>
    <g fill="${palette.muted}" font-family="sans-serif" font-size="${withScreenshot ? 23 : 26}">${textLines(summary, 80, withScreenshot ? 463 : 490, 34)}</g>
    <rect x="80" y="545" width="${textWidth}" height="2" fill="${palette.accent}" fill-opacity="0.75"/>
  </svg>`;
  const overlays: Array<{ input: Buffer; left: number; top: number }> = [];
  if (logoId) {
    const logo = await sharp(readFileSync(mediaFilePath(logoId)))
      .resize(72, 72, { fit: "inside" }).png().toBuffer();
    overlays.push({ input: logo, left: 1040, top: 75 });
  }
  if (row.screenshot_bytes) {
    const screenshot = await sharp(row.screenshot_bytes)
      .resize(420, 400, { fit: "cover", position: "attention" }).png().toBuffer();
    overlays.push({ input: screenshot, left: 704, top: 109 });
  }
  return {
    bytes: await sharp(Buffer.from(svg)).composite(overlays).png().toBuffer(),
    cacheable: true,
  };
}

export async function renderImportCard(slug: string,
  includeDraft: boolean): Promise<RenderedImportCard | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = cardSnapshot(slug, includeDraft);
    if (!snapshot) return null;
    const bytes = await cardCache.get(snapshot.revision, () => renderSnapshot(snapshot));
    const current = cardSnapshot(slug, includeDraft);
    if (!current) return null;
    if (current.revision === snapshot.revision) {
      return { bytes, revision: snapshot.revision };
    }
  }
  return null;
}
