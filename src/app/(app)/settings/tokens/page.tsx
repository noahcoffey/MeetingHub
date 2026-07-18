import { listApiTokens } from "@/lib/api-tokens";
import { listWorkspaces } from "@/lib/workspaces";
import { TokensManager } from "./tokens-manager";

export const dynamic = "force-dynamic";

export default async function TokensPage() {
  const [tokens, workspaces] = await Promise.all([
    listApiTokens(),
    listWorkspaces(),
  ]);

  return (
    <div className="settings-section">
      <h1 className="page-title">API tokens</h1>
      <p className="muted page-subtitle">
        Bearer tokens for the <code>/api/v1</code> API — scripts and
        integrations authenticate with{" "}
        <code>Authorization: Bearer mh_…</code>. Each token is read-only or
        read + write, and can be restricted to specific workspaces.{" "}
        <a href="/api-docs.html" target="_blank" rel="noopener noreferrer">
          API documentation ↗
        </a>
      </p>
      <TokensManager
        initialTokens={tokens.map((t) => ({
          id: t.id,
          name: t.name,
          tokenPrefix: t.tokenPrefix,
          scope: t.scope,
          workspaceIds: t.workspaceIds,
          expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
          lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
          createdAt: t.createdAt.toISOString(),
        }))}
        workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
      />
    </div>
  );
}
