import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createApiToken, listApiTokens } from "@/lib/api-tokens";
import { listWorkspaces } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

const SCOPES = ["read", "write"] as const;
type Scope = (typeof SCOPES)[number];
const EXPIRY_DAYS = [30, 90, 365] as const;

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ tokens: await listApiTokens() });
});

export const POST = auth(async (req) => {
  const userId = req.auth?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { name, scope, workspaceIds, expiresInDays } = (body ?? {}) as {
    name?: unknown;
    scope?: unknown;
    workspaceIds?: unknown;
    expiresInDays?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "" || name.length > 100) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!SCOPES.includes(scope as Scope)) {
    return NextResponse.json(
      { error: "scope must be read or write" },
      { status: 400 },
    );
  }
  let ids: string[] | null = null;
  if (workspaceIds !== undefined && workspaceIds !== null) {
    if (
      !Array.isArray(workspaceIds) ||
      workspaceIds.some((id) => typeof id !== "string")
    ) {
      return NextResponse.json(
        { error: "workspaceIds must be an array of ids or null" },
        { status: 400 },
      );
    }
    const known = new Set((await listWorkspaces()).map((w) => w.id));
    if (workspaceIds.some((id) => !known.has(id))) {
      return NextResponse.json(
        { error: "unknown workspace id" },
        { status: 400 },
      );
    }
    ids = workspaceIds;
  }
  let expiresAt: Date | null = null;
  if (expiresInDays !== undefined && expiresInDays !== null) {
    if (!EXPIRY_DAYS.includes(expiresInDays as (typeof EXPIRY_DAYS)[number])) {
      return NextResponse.json(
        { error: "expiresInDays must be 30, 90, or 365" },
        { status: 400 },
      );
    }
    expiresAt = new Date(
      Date.now() + (expiresInDays as number) * 24 * 60 * 60 * 1000,
    );
  }

  const { token, secret } = await createApiToken(userId, {
    name: name.trim(),
    scope: scope as Scope,
    workspaceIds: ids,
    expiresAt,
  });
  // The only time the secret crosses the wire — it's not stored anywhere.
  return NextResponse.json({ token, secret }, { status: 201 });
});
