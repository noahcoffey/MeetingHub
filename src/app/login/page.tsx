import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Meeting Hub</h1>
        <p className="muted">Sign in to continue.</p>
        <LoginForm />
      </div>
    </main>
  );
}
