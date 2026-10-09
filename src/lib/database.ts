import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const url = process.env.DATABASE_URL ?? "file:./.runtime/directory.db";
if (!url.startsWith("file:")) {
  throw new Error("DATABASE_URL must be a file: SQLite URL.");
}

const file = url.slice("file:".length);
if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

export const database = new Database(file);
database.pragma("journal_mode = WAL");
