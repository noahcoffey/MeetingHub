// Break-glass auth recovery. Clears ALL passkeys + recovery codes and re-enables
// password login so you can sign in with your password again. Run ON THE SERVER
// (Dokploy terminal or `docker exec … npm run auth:reset`) — it needs DATABASE_URL.
// Optionally set RESET_PASSWORD to also set a brand-new password in the same run.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { users, webauthnCredentials, recoveryCodes } from "./schema";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  await db.delete(webauthnCredentials);
  await db.delete(recoveryCodes);

  const newPassword = process.env.RESET_PASSWORD;
  if (newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.update(users).set({ passwordHash, passwordEnabled: true });
    console.log(
      "[auth:reset] cleared passkeys + recovery codes, set a new password, password login enabled.",
    );
  } else {
    await db.update(users).set({ passwordEnabled: true });
    console.log(
      "[auth:reset] cleared passkeys + recovery codes, password login re-enabled.",
    );
  }

  await client.end();
}

main().catch((err) => {
  console.error("[auth:reset] failed:", err);
  process.exit(1);
});
