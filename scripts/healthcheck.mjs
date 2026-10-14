import Database from 'better-sqlite3';
import { parseDatabaseUrl } from '../src/lib/database-url.mjs';

async function main() {
  const database = new Database(parseDatabaseUrl(process.env.DATABASE_URL),
    { readonly: true, fileMustExist: true });
  try {
    const ready = database.prepare('SELECT 1 FROM catalog_migrations WHERE version = 18').get();
    if (!ready) throw new Error('Catalog migration is incomplete');
  } finally {
    database.close();
  }
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? '3000'}/listings`,
    { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`Public directory returned HTTP ${response.status}`);
}

main().catch((error) => {
  process.stderr.write(`Health check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
