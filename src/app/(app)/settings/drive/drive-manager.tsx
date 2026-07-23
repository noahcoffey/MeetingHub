"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Account = { id: string; email: string; createdAt: string };

const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    "Google isn't configured on this server (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
  denied: "The Google connection was cancelled.",
  state: "The connection could not be verified — please try again.",
  exchange:
    "Google sign-in failed. If it persists, remove this app under your Google account's third-party access and retry.",
  no_user: "No user to attach the account to.",
};

export function DriveManager({
  configured,
  account,
  connected,
  error,
}: {
  configured: boolean;
  account: Account | null;
  connected: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    await fetch("/api/drive/disconnect", { method: "POST" });
    setConfirming(false);
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="settings-section">
      <h2 className="settings-h2">Drive files</h2>
      <p className="muted settings-desc">
        Connect a Google account to store files in Drive. The app creates a{" "}
        <code>MeetingHub</code> folder with a subtree per workspace — a general
        Files area plus one folder per project. Only files the app itself
        creates are visible to it; disconnecting never touches anything in
        Drive.
      </p>

      {connected && (
        <p className="settings-banner ok">Connected {connected}.</p>
      )}
      {error && (
        <p className="settings-banner err">
          {ERROR_MESSAGES[error] ?? "Something went wrong."}
        </p>
      )}

      <h3 className="stat-archived-h">Drive account</h3>
      {!configured ? (
        <p className="muted empty-sm">
          Google is not configured on this server. Set{" "}
          <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to
          enable it (see the README).
        </p>
      ) : account ? (
        <ul className="account-list">
          <li className="account-row">
            <span className="account-email">{account.email}</span>
            {confirming ? (
              <span className="stat-row-actions">
                <button
                  type="button"
                  className="danger-btn"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  Really disconnect
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="ghost-btn danger"
                onClick={() => setConfirming(true)}
              >
                Disconnect
              </button>
            )}
          </li>
        </ul>
      ) : (
        <>
          <p className="muted empty-sm">No Drive account connected yet.</p>
          {/* Full-page navigation into the OAuth 302 — must be a plain <a>, not
              <Link>. The rule only started matching this href once /api gained
              a dynamic segment (the MCP [transport] route). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="primary-btn account-connect" href="/api/drive/google/connect">
            Connect Google Drive
          </a>
        </>
      )}
    </section>
  );
}
