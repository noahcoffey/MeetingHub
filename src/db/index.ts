import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

// Lazy singleton. The connection is created on first query — NOT at import time —
// so building the app (which loads route modules to collect page data) doesn't
// require DATABASE_URL to be present.
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
  drizzleDb?: Database;
};

function getDb(): Database {
  if (globalForDb.drizzleDb) return globalForDb.drizzleDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = globalForDb.pgClient ?? postgres(connectionString, { max: 10 });
  const dbInstance = drizzle(client, { schema });

  // Cache across hot reloads (dev) and module re-eval to avoid leaking connections.
  globalForDb.pgClient = client;
  globalForDb.drizzleDb = dbInstance;
  return dbInstance;
}

// Proxy so `db.select(...)` etc. resolve the real instance lazily on first access.
export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
