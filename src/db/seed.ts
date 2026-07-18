// Seeds exactly one user from env. Idempotent: updates the password hash if the
// user already exists, so rotating SEED_USER_PASSWORD just works on next deploy.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "./schema";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;

  if (!connectionString) throw new Error("DATABASE_URL is not set");
  if (!email || !password) {
    throw new Error("SEED_USER_EMAIL and SEED_USER_PASSWORD must be set");
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.email, email));
    console.log(`[seed] updated existing user ${email}`);
  } else {
    await db.insert(users).values({ email, passwordHash });
    console.log(`[seed] created user ${email}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
