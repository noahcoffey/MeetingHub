// Standalone migration runner. Used by `npm run db:migrate` and the Docker entrypoint.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  // Dedicated single-connection client for migrations.
  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);

  console.log("[migrate] applying migrations from ./drizzle ...");
  await migrate(db, { migrationsFolder: "./drizzle" });

  // One-time adoption of the legacy env-configured calendar feed: the ICS URL
  // now lives on the workspace row (Settings -> Workspaces). Runs in TS, not a
  // SQL migration, because the value comes from the environment. Idempotent —
  // only fills the default workspace's ics_url while it is still NULL, so a
  // URL saved in Settings is never overwritten.
  const legacyIcsUrl = process.env.CALENDAR_ICS_URL;
  if (legacyIcsUrl) {
    const adopted = await migrationClient`
      UPDATE workspaces SET ics_url = ${legacyIcsUrl}, updated_at = now()
      WHERE is_default AND ics_url IS NULL
    `;
    if (adopted.count > 0) {
      console.log("[migrate] adopted CALENDAR_ICS_URL into the default workspace");
    }
  }

  console.log("[migrate] done.");

  await migrationClient.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
