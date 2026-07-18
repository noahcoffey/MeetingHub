"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { PromptDialog } from "../../confirm-dialog";

type Cred = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SecurityManager({
  credentials,
  passwordEnabled,
  recoveryCount,
}: {
  credentials: Cred[];
  passwordEnabled: boolean;
  recoveryCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwEnabled, setPwEnabled] = useState(passwordEnabled);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const hasPasskeys = credentials.length > 0;

  async function addPasskey() {
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch("/api/webauthn/register/options");
      if (!optRes.ok) throw new Error("options");
      const options = await optRes.json();
      const attestation = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: attestation }),
      });
      const data = await verifyRes.json();
      if (!data.verified) {
        setError("Couldn't register that passkey. Try again.");
        return;
      }
      if (Array.isArray(data.recovery)) {
        setCodes(data.recovery);
        setPwEnabled(false);
      }
      router.refresh();
    } catch (err) {
      if ((err as Error)?.name !== "NotAllowedError") {
        setError("Passkey registration was cancelled or failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/webauthn/credentials/${id}`, { method: "DELETE" });
      // Server re-enables password if this was the last passkey.
      if (credentials.length === 1) setPwEnabled(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string, name: string) {
    await fetch(`/api/webauthn/credentials/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    router.refresh();
  }

  async function regenerateCodes() {
    setBusy(true);
    try {
      const res = await fetch("/api/recovery-codes", { method: "POST" });
      const data = await res.json();
      if (Array.isArray(data.codes)) setCodes(data.codes);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function togglePassword(next: boolean) {
    setPwEnabled(next);
    await fetch("/api/security/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    router.refresh();
  }

  return (
    <div className="security">
      <section className="sec-block">
        <div className="sec-head">
          <h2>Passkeys</h2>
          <button
            type="button"
            className="primary-btn"
            onClick={addPasskey}
            disabled={busy}
          >
            {busy ? "Working…" : "Add a passkey"}
          </button>
        </div>
        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}
        {credentials.length === 0 ? (
          <p className="ai-empty">
            No passkeys yet. Add one (your YubiKey or Touch ID) to enable
            passwordless sign-in.
          </p>
        ) : (
          <ul className="sec-list">
            {credentials.map((c) => (
              <li key={c.id} className="sec-item">
                <div className="sec-item-main">
                  <span className="sec-item-name">{c.name}</span>
                  <span className="sec-item-meta">
                    Added {fmt(c.createdAt)}
                    {c.lastUsedAt ? ` · last used ${fmt(c.lastUsedAt)}` : ""}
                  </span>
                </div>
                <div className="sec-item-actions">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setRenaming({ id: c.id, name: c.name })}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="link-btn danger"
                    onClick={() => removePasskey(c.id)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sec-block">
        <div className="sec-head">
          <h2>Recovery codes</h2>
          <button
            type="button"
            className="ghost-btn"
            onClick={regenerateCodes}
            disabled={busy}
          >
            {recoveryCount > 0 ? "Regenerate" : "Generate"}
          </button>
        </div>
        <p className="muted sec-note">
          One-time codes to get in if you lose your passkeys.{" "}
          {recoveryCount > 0
            ? `${recoveryCount} unused.`
            : "None yet — generate a set and store them safely."}
        </p>
      </section>

      <section className="sec-block">
        <div className="sec-head">
          <h2>Password login</h2>
          <button
            type="button"
            role="switch"
            aria-checked={pwEnabled}
            className={`trend-toggle ${pwEnabled ? "is-on" : ""}`}
            onClick={() => togglePassword(!pwEnabled)}
            disabled={busy || (!hasPasskeys && pwEnabled)}
            title={
              !hasPasskeys
                ? "Add a passkey before disabling password login"
                : undefined
            }
          >
            <span className="trend-switch" aria-hidden>
              <span className="trend-knob" />
            </span>
            {pwEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
        <p className="muted sec-note">
          {hasPasskeys
            ? "With passkeys set up, keep this off so your password can't be used to sign in."
            : "Add a passkey first; password login stays on until then."}
        </p>
      </section>

      {codes && (
        <div className="cmdk-overlay" onMouseDown={() => setCodes(null)}>
          <div className="kbd-card sec-codes" onMouseDown={(e) => e.stopPropagation()}>
            <div className="kbd-cheat-head">Save your recovery codes</div>
            <div className="sec-codes-body">
              <p className="muted">
                Each works once. Store them in your password manager — they
                won&apos;t be shown again.
              </p>
              <ul className="sec-codes-grid">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <div className="sec-codes-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() =>
                    navigator.clipboard?.writeText(codes.join("\n"))
                  }
                >
                  Copy all
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => setCodes(null)}
                >
                  I&apos;ve saved them
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PromptDialog
        open={renaming !== null}
        title="Rename passkey"
        label="Passkey name"
        defaultValue={renaming?.name ?? ""}
        confirmLabel="Save"
        onSubmit={(name) => {
          if (renaming) void rename(renaming.id, name);
          setRenaming(null);
        }}
        onCancel={() => setRenaming(null)}
      />
    </div>
  );
}
