// Prepares the meetinghub_e2e database before Playwright starts the server:
// create it, migrate to the latest schema (migration 0022 seeds the default
// workspace), seed one user with a known password, and clear any tokens from
// a prior run. Self-contained + raw SQL so tsx needs no alias resolution.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import bcrypt from "bcryptjs";
import { E2E_DATABASE_URL, E2E_EMAIL, E2E_PASSWORD } from "./constants";

async function main() {
  const admin = postgres(
    "postgres://meetinghub:meetinghub@localhost:5432/meetinghub",
    { max: 1 },
  );
  try {
    const exists =
      await admin`select 1 from pg_database where datname = 'meetinghub_e2e'`;
    if (exists.length === 0) {
      await admin.unsafe("create database meetinghub_e2e");
    }
  } finally {
    await admin.end();
  }

  const client = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    const hash = await bcrypt.hash(E2E_PASSWORD, 10);
    await client`
      insert into users (email, password_hash, password_enabled)
      values (${E2E_EMAIL}, ${hash}, true)
      on conflict (email) do update
        set password_hash = excluded.password_hash, password_enabled = true`;
    // Fresh token list each run.
    await client`truncate api_tokens`;
    console.log("[e2e] database ready");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
