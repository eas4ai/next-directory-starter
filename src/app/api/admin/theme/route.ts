import { isAdmin } from "@/lib/admin";
import { database } from "@/lib/database";

database.exec(`CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`);

export async function GET(request: Request) {
  if (!(await isAdmin(request.headers))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = database.prepare("SELECT value FROM site_settings WHERE key = ?")
    .get("theme") as { value: string } | undefined;
  return Response.json({ preset: row ? JSON.parse(row.value) : null });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request.headers))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const siteOrigin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== siteOrigin) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  let preset: unknown;
  try {
    const body = await request.text();
    if (body.length > 8192) throw new Error("Theme request is too large");
    preset = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
    return Response.json({ error: "Theme must be an object" }, { status: 400 });
  }

  database.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run("theme", JSON.stringify(preset));
  return Response.json({ preset });
}
