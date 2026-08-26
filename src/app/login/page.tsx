import { getSingleUser } from "@/lib/webauthn";
import { LoginForm } from "./login-form";

// Reads password_enabled per request — never bake the build-time value in.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Pre-seed (no user row) falls back to showing password, like the security page.
  const user = await getSingleUser().catch(() => undefined);
  const passwordEnabled = user?.passwordEnabled ?? true;

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Meeting Hub</h1>
        <p className="muted">Sign in to continue.</p>
        <LoginForm passwordEnabled={passwordEnabled} />
      </div>
    </main>
  );
}
