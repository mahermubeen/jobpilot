import fs from "node:fs";
import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

export type Db = PgliteDatabase<typeof schema>;

export function dataDir(): string {
  const dir = process.env.JOBPILOT_DATA_DIR
    ? path.resolve(process.env.JOBPILOT_DATA_DIR)
    : path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const migrationsFolder = () => path.join(process.cwd(), "drizzle");

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Hosted Postgres (for example Supabase). Same schema, same queries.
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const postgres = (await import("postgres")).default;
    const db = drizzle(postgres(url, { prepare: false }), { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    return db as unknown as Db;
  }
  // Embedded Postgres stored in ./data, nothing to install.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(path.join(dataDir(), "db"));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

// One connection per process, surviving dev hot reloads.
const g = globalThis as unknown as { __jobpilotDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__jobpilotDb) {
    g.__jobpilotDb = open().catch((err) => {
      g.__jobpilotDb = undefined;
      throw err;
    });
  }
  return g.__jobpilotDb;
}

export { schema };
