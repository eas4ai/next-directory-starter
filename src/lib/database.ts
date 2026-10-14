import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DATABASE_URL, parseDatabaseUrl } from "@/lib/database-url.mjs";

const file = parseDatabaseUrl(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  { allowMemory: process.env.NODE_ENV === "test" });
if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

export const database = new Database(file);
database.pragma("foreign_keys = ON");
