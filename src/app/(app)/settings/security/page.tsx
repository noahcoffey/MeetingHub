import { auth } from "@/auth";
import {
  countUnusedRecoveryCodes,
  getUserById,
  listCredentials,
} from "@/lib/webauthn";
import { SecurityManager } from "./security-manager";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null; // middleware guards this route anyway

  const [creds, user, recoveryCount] = await Promise.all([
    listCredentials(userId),
    getUserById(userId),
    countUnusedRecoveryCodes(userId),
  ]);

  return (
    <div className="settings-section">
      <h1 className="page-title">Security</h1>
      <p className="muted page-subtitle">
        Sign in with a passkey (Touch ID, a security key, etc.). Passwordless once a
        passkey is registered.
      </p>
      <SecurityManager
        credentials={creds.map((c) => ({
          id: c.id,
          name: c.name,
          createdAt: new Date(c.createdAt).toISOString(),
          lastUsedAt: c.lastUsedAt ? new Date(c.lastUsedAt).toISOString() : null,
        }))}
        passwordEnabled={user?.passwordEnabled ?? true}
        recoveryCount={recoveryCount}
      />
    </div>
  );
}
