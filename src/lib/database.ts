import Database from "better-sqlite3";

const url = process.env.DATABASE_URL ?? "file:./directory.db";
if (!url.startsWith("file:")) {
  throw new Error("DATABASE_URL must be a file: SQLite URL.");
}

export const database = new Database(url.slice("file:".length));
database.pragma("journal_mode = WAL");
