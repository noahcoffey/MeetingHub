"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { authenticate, authenticateRecovery } from "./actions";
import { safeCallbackUrl } from "@/lib/safe-redirect";

type Panel = "passkey" | "password" | "recovery";

export function LoginForm({ passwordEnabled }: { passwordEnabled: boolean }) {
  const params = useSearchParams();
  // Only same-origin relative paths — never an off-site redirect (phishing guard).
  const callbackUrl = safeCallbackUrl(params.get("callbackUrl"));
  const [panel, setPanel] = useState<Panel>("passkey");
  const [busy, setBusy] = useState(false);
  const [pkError, setPkError] = useState<string | null>(null);

  const [pwError, pwAction, pwPending] = useActionState(authenticate, undefined);
  const [rcError, rcAction, rcPending] = useActionState(
    authenticateRecovery,
    undefined,
  );

  async function passkey() {
    setBusy(true);
    setPkError(null);
    try {
      const res = await fetch("/api/webauthn/authenticate/options");
      if (!res.ok) throw new Error("options");
      const options = await res.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const result = await signIn("passkey", {
        response: JSON.stringify(assertion),
        redirect: false,
      });
      if (result && !result.error) {
        window.location.assign(callbackUrl);
        return;
      }
      setPkError("That passkey wasn't recognized.");
    } catch (err) {
      // User dismissed the prompt — not an error worth showing.
      if ((err as Error)?.name !== "NotAllowedError") {
        setPkError("Couldn't sign in with a passkey. Try another method.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-stack">
      {panel === "passkey" && (
        <>
          <button
            type="button"
            className="passkey-btn"
            onClick={passkey}
            disabled={busy}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
              <circle cx="7.5" cy="7" r="3.2" strokeWidth="1.6" />
              <path
                d="M2.5 16.5c.6-2.6 2.7-4 5-4 .9 0 1.7.2 2.4.6M13 9.5l4 4M15 11.5l-1.5 1.5M17 13.5l-1.3 1.3"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {busy ? "Waiting for passkey…" : "Sign in with a passkey"}
          </button>
          {pkError && (
            <p role="alert" className="login-error">
              {pkError}
            </p>
          )}
          <div className="login-alts">
            {passwordEnabled && (
              <>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setPanel("password")}
                >
                  Use password
                </button>
                <span aria-hidden>·</span>
              </>
            )}
            <button
              type="button"
              className="link-btn"
              onClick={() => setPanel("recovery")}
            >
              Use a recovery code
            </button>
          </div>
        </>
      )}

      {panel === "password" && passwordEnabled && (
        <form action={pwAction} className="login-form">
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </label>
          {pwError && (
            <p role="alert" className="login-error">
              {pwError}
            </p>
          )}
          <button type="submit" disabled={pwPending}>
            {pwPending ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => setPanel("passkey")}
          >
            ← Back to passkey
          </button>
        </form>
      )}

      {panel === "recovery" && (
        <form action={rcAction} className="login-form">
          <label>
            Recovery code
            <input
              type="text"
              name="code"
              autoComplete="one-time-code"
              placeholder="XXXXX-XXXXX"
              required
              autoFocus
            />
          </label>
          {rcError && (
            <p role="alert" className="login-error">
              {rcError}
            </p>
          )}
          <button type="submit" disabled={rcPending}>
            {rcPending ? "Signing in…" : "Use recovery code"}
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => setPanel("passkey")}
          >
            ← Back to passkey
          </button>
        </form>
      )}
    </div>
  );
}
