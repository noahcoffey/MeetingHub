"use client";

import { useState } from "react";

type Account = { id: string; email: string; createdAt: string };

const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    "Google isn't configured on this server (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
  denied: "The Google connection was cancelled.",
  state: "The connection could not be verified — please try again.",
  exchange: "Google sign-in failed. If it persists, remove this app under your Google account's third-party access and retry.",
  no_user: "No user to attach the account to.",
};

export function CalendarsManager({
  configured,
  initial,
  connected,
  error,
}: {
  configured: boolean;
  initial: Account[];
  connected: string | null;
  error: string | null;
}) {
  const [accounts, setAccounts] = useState<Account[]>(initial);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function disconnect(id: string) {
    await fetch(`/api/calendar/google/accounts/${id}`, { method: "DELETE" });
    setAccounts((a) => a.filter((x) => x.id !== id));
    setConfirmId(null);
  }

  return (
    <section className="settings-section">
      <h2 className="settings-h2">Calendars</h2>
      <p className="muted settings-desc">
        Connect one or more Google accounts, then choose which calendar each
        workspace imports from under{" "}
        <a className="link-btn" href="/settings/workspaces">
          Workspaces
        </a>
        . A published <code>.ics</code> feed URL is still available there as a
        zero-config alternative.
      </p>

      {connected && (
        <p className="settings-banner ok">Connected {connected}.</p>
      )}
      {error && (
        <p className="settings-banner err">
          {ERROR_MESSAGES[error] ?? "Something went wrong."}
        </p>
      )}

      <h3 className="stat-archived-h">Connected Google accounts</h3>
      {!configured ? (
        <p className="muted empty-sm">
          Google is not configured on this server. Set{" "}
          <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to
          enable it (see the README).
        </p>
      ) : (
        <>
          {accounts.length === 0 ? (
            <p className="muted empty-sm">No Google accounts connected yet.</p>
          ) : (
            <ul className="account-list">
              {accounts.map((a) => (
                <li key={a.id} className="account-row">
                  <span className="account-email">{a.email}</span>
                  {confirmId === a.id ? (
                    <span className="stat-row-actions">
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() => void disconnect(a.id)}
                      >
                        Really disconnect
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setConfirmId(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="ghost-btn danger"
                      onClick={() => setConfirmId(a.id)}
                    >
                      Disconnect
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* Full-page navigation into the OAuth 302 — must be a plain <a>, not
              <Link>. The rule only started matching this href once /api gained
              a dynamic segment (the MCP [transport] route). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="primary-btn account-connect" href="/api/calendar/google/connect">
            Connect a Google account
          </a>
        </>
      )}
    </section>
  );
}
