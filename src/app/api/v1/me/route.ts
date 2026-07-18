import { NextResponse } from "next/server";
import { getApiToken } from "@/lib/api-tokens";
import { listWorkspaces } from "@/lib/workspaces";
import { err, isWorkspaceAllowed, withV1 } from "../_lib/helpers";

export const dynamic = "force-dynamic";

// Token introspection: what this token is and what it can reach.
export const GET = withV1({}, async (_req, _ctx, principal) => {
  const token = await getApiToken(principal.tokenId);
  if (!token) return err("unauthorized", 401);
  const workspaces = (await listWorkspaces())
    .filter((w) => isWorkspaceAllowed(principal, w.id))
    .map((w) => ({ id: w.id, name: w.name }));
  return NextResponse.json({
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scope: token.scope,
    allWorkspaces: principal.allowedWorkspaceIds === null,
    workspaces,
    expiresAt: token.expiresAt,
  });
});
