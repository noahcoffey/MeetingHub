import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { TEST_DATABASE_URL, TEST_USER_ID } from "./constants";

// Runs once before the test suite: create the test database if it doesn't
// exist, bring it to the latest migration, and seed the single user.
export default async function setup() {
  const admin = postgres(
    "postgres://meetinghub:meetinghub@localhost:5432/meetinghub",
    { max: 1 },
  );
  try {
    const exists =
      await admin`select 1 from pg_database where datname = 'meetinghub_test'`;
    if (exists.length === 0) {
      await admin.unsafe("create database meetinghub_test");
    }
  } finally {
    await admin.end();
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    await client`
      insert into users (id, email, password_hash)
      values (${TEST_USER_ID}, 'test@example.com', 'not-a-real-hash')
      on conflict (id) do nothing`;
  } finally {
    await client.end();
  }
}
