import { database } from "@/lib/database";

database.exec(`CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`);

export function readSiteSetting(key: string): string | null {
  return database.prepare("SELECT value FROM site_settings WHERE key = ?")
    .pluck().get(key) as string | undefined ?? null;
}

export function writeSiteSetting(key: string, value: string): void {
  database.prepare(`INSERT INTO site_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}
