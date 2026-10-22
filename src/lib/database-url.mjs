export const DEFAULT_DATABASE_URL = "file:./.runtime/directory.db";

export function parseDatabaseUrl(url, { allowMemory = false } = {}) {
  if (typeof url !== "string" || !url.startsWith("file:")) {
    throw new Error("DATABASE_URL must be a file: SQLite URL.");
  }

  const file = url.slice("file:".length);
  if (!file || file.includes("?") || file.includes("#") || file.includes("\0")) {
    throw new Error("DATABASE_URL must name a SQLite file without a query or fragment.");
  }
  if (file === ":memory:" && !allowMemory) {
    throw new Error("DATABASE_URL must name a persistent SQLite file.");
  }

  return file;
}
