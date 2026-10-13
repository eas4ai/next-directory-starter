import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import { database } from "@/lib/database";
import { publishedArticleBySlug } from "@/lib/articles";
import { renderImportCard } from "@/lib/agent-cards";
import { getSiteConfig, type SiteConfig } from "@/lib/site-config";
import { publishedListingBySlug } from "@/lib/listings";
import { assignedMedia, mediaFilePath, publicMediaAsset } from "@/lib/media";
import { getSeoSettings, publicSeoOverrides, type SeoSettings } from "@/lib/seo-settings";
import { getThemePreset } from "@/lib/theme";
import { getThemeSelection } from "@/lib/theme-selection";
import { socialPaletteForSelection } from "@/lib/theme-sdk";
import { MAX_SOURCE_BYTES, requestPinnedImage } from "@/lib/pinned-image-request";
import { SocialCardRenderCache, socialCardRevision,
  type SocialCardRenderResult } from "@/lib/social-card-cache";

const WIDTH = 1200;
const HEIGHT = 630;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type CardContent = { title: string; description: string; category: string; source?: string };
type SocialPalette = ReturnType<typeof socialPaletteForSelection>;
type CardSnapshot = {
  content: CardContent;
  site: SiteConfig;
  palette: SocialPalette;
  revision: string;
};

export type RenderedSocialCard = { bytes: Buffer; revision: string };

const cardCache = new SocialCardRenderCache({
  maxEntries: 32,
  maxBytes: 16 * 1024 * 1024,
  maxConcurrent: 2,
  maxWaiting: 16,
});

function publicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    // Only global IPv6 unicast. This also excludes mapped IPv4, loopback and link-local.
    return /^[23][0-9a-f]/i.test(address);
  }
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a !== 255 && a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 0 || (b === 168) || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113);
}

async function externalImage(value: string): Promise<Buffer | null> {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  let addresses: Array<{ address: string; family: number }>;
  let dnsDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        dnsDeadline = setTimeout(() => reject(new Error("DNS timeout")), 5000);
      }),
    ]);
  }
  catch { return null; }
  finally { clearTimeout(dnsDeadline); }
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) return null;
  return requestPinnedImage(url, addresses[0]);
}

async function sourceImage(source?: string): Promise<Buffer | null> {
  if (!source) return null;
  if (/^https?:\/\//i.test(source)) return externalImage(source);
  if (!source.startsWith("/") || source.startsWith("//") || source.includes("\\") ||
      /[?#\u0000-\u001f]/.test(source) || source.split("/").some((part) => part === "..")) return null;
  const mediaId = /^\/media\/([0-9a-f-]{36})$/.exec(source)?.[1];
  if (mediaId) {
    if (!publicMediaAsset(mediaId)) return null;
    try { return await readFile(mediaFilePath(mediaId)); } catch { return null; }
  }
  const brandId = /^\/brand-assets\/([0-9a-f-]{36})\.webp$/.exec(source)?.[1];
  if (brandId) {
    const brand = getSiteConfig();
    if (![brand.logoUrl, brand.iconUrl, brand.socialImage].includes(source)) return null;
    try { return await readFile(mediaFilePath(brandId)); } catch { return null; }
  }
  const imported = /^\/og\/listings\/([a-z0-9]+(?:-[a-z0-9]+)*)\.png$/.exec(source)?.[1];
  if (imported) return (await renderImportCard(imported, false))?.bytes ?? null;
  const root = resolve(process.cwd(), "public");
  const file = resolve(root, source.slice(1));
  if (!file.startsWith(root + sep)) return null;
  try { return await readFile(file); } catch { return null; }
}

function cardContent(path: string, site: SiteConfig, settings: SeoSettings): CardContent | null {
  if (path === "/" || path === "/listings" || path === "/articles") return {
    title: path === "/" ? site.name : path === "/listings" ? "Explore listings" : "Read articles",
    description: path === "/" ? settings.description : site.description,
    category: path === "/" ? "Directory" : path.slice(1),
    source: settings.socialImage || site.socialImage,
  };
  const match = /^\/(listings|articles)\/([^/]+)$/.exec(path);
  if (!match || !slugPattern.test(match[2])) return null;
  const [, kind, slug] = match;
  if (kind === "listings") {
    const listing = publishedListingBySlug(slug);
    if (!listing) return null;
    const media = assignedMedia("listing", slug, "public");
    const imported = database.prepare("SELECT 1 FROM agent_imports WHERE slug = ?").get(slug);
    return {
      title: listing.name, description: listing.summary, category: listing.category,
      source: publicSeoOverrides("listing", slug).socialImage ||
        (media ? `/media/${media.id}` : undefined) || settings.socialImage ||
        (imported ? `/og/listings/${slug}.png` : undefined) || site.socialImage,
    };
  }
  const article = publishedArticleBySlug(slug);
  if (!article) return null;
  const media = assignedMedia("article", slug, "public");
  return {
    title: article.title, description: article.summary, category: article.category || "Article",
    source: article.seo.socialImage || (media ? `/media/${media.id}` : undefined) ||
      settings.socialImage || site.socialImage,
  };
}

function cardSnapshot(path: string): CardSnapshot | null {
  const site = getSiteConfig();
  const settings = getSeoSettings();
  const content = cardContent(path, site, settings);
  if (!content) return null;
  const selection = getThemeSelection();
  const palette = socialPaletteForSelection(getThemePreset(), selection.themeId);
  return {
    content,
    site,
    palette,
    revision: socialCardRevision(`page:${path}`, {
      content,
      branding: site,
      theme: { selection, palette },
    }),
  };
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function lines(value: string, maxLength: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const result: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxLength) {
      result.push(line);
      line = word;
      if (result.length === maxLines) break;
    } else line = line ? `${line} ${word}` : word;
  }
  if (result.length < maxLines && line) result.push(line);
  return result.map((part) => xml(part.slice(0, maxLength + 8)));
}

async function renderSnapshot({ content, site, palette }: CardSnapshot): Promise<SocialCardRenderResult> {
  let photo: Buffer | null = null;
  let cacheable = !content.source;
  try {
    const input = await sourceImage(content.source);
    if (input && input.length <= MAX_SOURCE_BYTES) {
      const image = sharp(input, { limitInputPixels: 4096 * 4096, failOn: "warning" });
      const info = await image.metadata();
      if (["png", "jpeg", "webp", "avif"].includes(info.format ?? "") &&
          (info.pages ?? 1) === 1) {
        photo = await image.rotate().resize(436, 400, { fit: "contain",
          background: palette.background }).png().toBuffer();
        cacheable = true;
      }
    }
  } catch { /* Invalid or unavailable source uses the generated card. */ }
  const textWidth = photo ? 34 : 69;
  const title = lines(content.title, textWidth, 3);
  const summary = lines(content.description, photo ? 46 : 84, 3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="${palette.background}"/><stop offset="1" stop-color="${palette.accent}" stop-opacity="0.42"/>
    </linearGradient></defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
    <rect x="48" y="48" width="1104" height="534" rx="28" fill="${palette.foreground}" fill-opacity="0.06" stroke="${palette.foreground}" stroke-opacity="0.2"/>
    <rect x="80" y="88" width="9" height="38" rx="4" fill="${palette.accent}"/>
    <g fill="${palette.foreground}" font-family="sans-serif" font-size="24" font-weight="600"><text x="105" y="116">${xml(site.name.slice(0, 42))}</text></g>
    <g fill="${palette.accent}" font-family="sans-serif" font-size="20" font-weight="600"><text x="80" y="182">${xml(content.category.slice(0, 72).toUpperCase())}</text></g>
    <g fill="${palette.foreground}" font-family="sans-serif" font-size="${photo ? 48 : 60}" font-weight="700">${title.map((line, index) => `<text x="80" y="${255 + index * (photo ? 58 : 72)}">${line}</text>`).join("")}</g>
    <g fill="${palette.muted}" font-family="sans-serif" font-size="${photo ? 22 : 26}">${summary.map((line, index) => `<text x="80" y="${photo ? 461 + index * 31 : 490 + index * 34}">${line}</text>`).join("")}</g>
    <rect x="80" y="545" width="${photo ? 620 : 1040}" height="2" fill="${palette.accent}" fill-opacity="0.75"/>
  </svg>`;
  const overlays = photo ? [{ input: photo, left: 700, top: 112 }] : [];
  const bytes = await sharp(Buffer.from(svg)).composite(overlays).png().toBuffer();
  return { bytes, cacheable };
}

export async function renderSocialCard(path: string): Promise<RenderedSocialCard | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = cardSnapshot(path);
    if (!snapshot) return null;
    const bytes = await cardCache.get(snapshot.revision, () => renderSnapshot(snapshot));
    const current = cardSnapshot(path);
    if (!current) return null;
    if (current.revision === snapshot.revision) {
      return { bytes, revision: snapshot.revision };
    }
  }
  return null;
}
