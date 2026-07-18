"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../confirm-dialog";

type Row = {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: "read" | "write";
  workspaceIds: string[] | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type WorkspaceOption = { id: string; name: string };

const EXPIRY_OPTIONS = [
  { value: "never", label: "Never expires" },
  { value: "30", label: "Expires in 30 days" },
  { value: "90", label: "Expires in 90 days" },
  { value: "365", label: "Expires in 1 year" },
] as const;

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TokensManager({
  initialTokens,
  workspaces,
}: {
  initialTokens: Row[];
  workspaces: WorkspaceOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialTokens);

  // Create form
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [allWorkspaces, setAllWorkspaces] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string>("never");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One-time secret display + revoke confirm
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<Row | null>(null);

  function workspaceNames(ids: string[] | null): string {
    if (!ids || ids.length === 0) return "All workspaces";
    return ids
      .map((id) => workspaces.find((w) => w.id === id)?.name ?? "(deleted)")
      .join(", ");
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || creating) return;
    if (!allWorkspaces && selected.length === 0) {
      setError("Pick at least one workspace, or allow all.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scope,
          workspaceIds: allWorkspaces ? null : selected,
          expiresInDays: expiry === "never" ? null : Number(expiry),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Couldn't create the token. Try again.");
        return;
      }
      const data = (await res.json()) as { token: Row; secret: string };
      setRows((r) => [data.token, ...r]);
      setSecret(data.secret);
      setCopied(false);
      setName("");
      setScope("read");
      setAllWorkspaces(true);
      setSelected([]);
      setExpiry("never");
      router.refresh();
    } catch {
      setError("Couldn't create the token. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(row: Row) {
    setRows((r) => r.filter((x) => x.id !== row.id));
    try {
      const res = await fetch(`/api/api-tokens/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setRows((r) => [row, ...r]);
    }
  }

  return (
    <div className="security">
      <section className="sec-block">
        <div className="sec-head">
          <h2>Create a token</h2>
        </div>
        <form
          onSubmit={create}
          style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}
        >
          <input
            type="text"
            value={name}
            placeholder="Token name (e.g. Shortcuts, Raycast)"
            aria-label="Token name"
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
            {(["read", "write"] as const).map((s) => (
              <label
                key={s}
                className="muted"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="token-scope"
                  checked={scope === s}
                  onChange={() => setScope(s)}
                />
                {s === "read" ? "Read-only" : "Read + write"}
              </label>
            ))}
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
          >
            <label
              className="muted"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.9rem",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={allWorkspaces}
                onChange={(e) => setAllWorkspaces(e.target.checked)}
              />
              All workspaces
            </label>
            {!allWorkspaces && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.4rem 0.9rem",
                  paddingLeft: "1.4rem",
                }}
              >
                {workspaces.map((w) => (
                  <label
                    key={w.id}
                    className="muted"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      fontSize: "0.85rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(w.id)}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, w.id]
                            : prev.filter((id) => id !== w.id),
                        )
                      }
                    />
                    {w.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <select
              value={expiry}
              aria-label="Expiry"
              onChange={(e) => setExpiry(e.target.value)}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="primary-btn"
              disabled={creating || name.trim() === ""}
            >
              {creating ? "Creating…" : "Create token"}
            </button>
          </div>
          {error && (
            <p role="alert" className="login-error" style={{ margin: 0 }}>
              {error}
            </p>
          )}
        </form>
      </section>

      <section className="sec-block">
        <div className="sec-head">
          <h2>Active tokens</h2>
        </div>
        {rows.length === 0 ? (
          <p className="ai-empty">
            No tokens yet. Create one to call the API from scripts and
            integrations.
          </p>
        ) : (
          <ul className="sec-list">
            {rows.map((t) => (
              <li key={t.id} className="sec-item">
                <div className="sec-item-main">
                  <span className="sec-item-name">
                    {t.name}{" "}
                    <code style={{ fontSize: "0.8em" }}>{t.tokenPrefix}…</code>{" "}
                    <span className="nav-pill">
                      {t.scope === "write" ? "Read + write" : "Read-only"}
                    </span>
                  </span>
                  <span className="sec-item-meta">
                    {workspaceNames(t.workspaceIds)} · created{" "}
                    {fmt(t.createdAt)}
                    {t.lastUsedAt
                      ? ` · last used ${fmt(t.lastUsedAt)}`
                      : " · never used"}
                    {t.expiresAt ? ` · expires ${fmt(t.expiresAt)}` : ""}
                  </span>
                </div>
                <div className="sec-item-actions">
                  <button
                    type="button"
                    className="link-btn danger"
                    onClick={() => setRevoking(t)}
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {secret && (
        <div className="cmdk-overlay" onMouseDown={() => setSecret(null)}>
          <div
            className="kbd-card sec-codes"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="kbd-cheat-head">Save your token</div>
            <div className="sec-codes-body">
              <p className="muted">
                This is the only time it will be shown. Store it in your
                password manager.
              </p>
              <ul className="sec-codes-grid">
                <li style={{ wordBreak: "break-all" }}>{secret}</li>
              </ul>
              <div className="sec-codes-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    navigator.clipboard?.writeText(secret);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => setSecret(null)}
                >
                  I&apos;ve saved it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke token?"
        message={
          revoking
            ? `"${revoking.name}" (${revoking.tokenPrefix}…) will stop working immediately. This can't be undone.`
            : undefined
        }
        confirmLabel="Revoke"
        danger
        onConfirm={() => {
          if (revoking) void revoke(revoking);
          setRevoking(null);
        }}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}
