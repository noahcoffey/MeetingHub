import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { deleteWorkspace, updateWorkspace } from "@/lib/workspaces";
import { WORKSPACE_COOKIE } from "@/lib/workspace-context";
import { assertUrlShape } from "@/lib/net-guard";
import { WORKSPACE_FEATURES, type WorkspaceFeature } from "@/db/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { name, icsUrl, sortOrder, disabledFeatures, googleAccountId, googleCalendarId } =
    (body ?? {}) as {
      name?: unknown;
      icsUrl?: unknown;
      sortOrder?: unknown;
      disabledFeatures?: unknown;
      googleAccountId?: unknown;
      googleCalendarId?: unknown;
    };

  const patch: {
    name?: string;
    icsUrl?: string | null;
    sortOrder?: number;
    disabledFeatures?: WorkspaceFeature[];
    googleAccountId?: string | null;
    googleCalendarId?: string | null;
  } = {};
  if (typeof name === "string" && name.trim() !== "") patch.name = name.trim();
  if (typeof icsUrl === "string") {
    const trimmed = icsUrl.trim();
    if (trimmed) {
      // Reject non-http(s) or internal-host feed URLs up front (SSRF guard);
      // the fetch path re-validates resolved IPs to defend against rebinding.
      try {
        assertUrlShape(trimmed);
      } catch {
        return NextResponse.json(
          { error: "calendar URL must be an http(s) URL to a public host" },
          { status: 400 },
        );
      }
      patch.icsUrl = trimmed;
    } else {
      patch.icsUrl = null;
    }
  } else if (icsUrl === null) patch.icsUrl = null;
  // Google calendar source is set/cleared as a pair. null (or absent calendar)
  // clears it; a string account id requires a calendar id.
  if (googleAccountId === null) {
    patch.googleAccountId = null;
    patch.googleCalendarId = null;
  } else if (
    typeof googleAccountId === "string" &&
    typeof googleCalendarId === "string" &&
    googleCalendarId !== ""
  ) {
    patch.googleAccountId = googleAccountId;
    patch.googleCalendarId = googleCalendarId;
  }
  if (typeof sortOrder === "number" && Number.isFinite(sortOrder)) {
    patch.sortOrder = sortOrder;
  }
  if (Array.isArray(disabledFeatures)) {
    const known = disabledFeatures.filter(
      (f): f is WorkspaceFeature =>
        typeof f === "string" &&
        (WORKSPACE_FEATURES as readonly string[]).includes(f),
    );
    if (known.length !== disabledFeatures.length) {
      return NextResponse.json({ error: "unknown feature" }, { status: 400 });
    }
    patch.disabledFeatures = [...new Set(known)];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const w = await updateWorkspace(id, patch);
  if (!w) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const item = {
    id: w.id,
    name: w.name,
    icsUrl: w.icsUrl,
    isDefault: w.isDefault,
    sortOrder: w.sortOrder,
    disabledFeatures: w.disabledFeatures,
  };
  return NextResponse.json({ item });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;

  const result = await deleteWorkspace(id);
  if (!result.ok) {
    if (result.reason === "default") {
      return NextResponse.json(
        { error: "cannot delete the default workspace" },
        { status: 400 },
      );
    }
    if (result.reason === "not-empty") {
      return NextResponse.json(
        { error: "not empty", counts: result.counts },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true });
  // If the just-deleted workspace was the active one, drop the stale cookie so
  // the reader falls back to the default workspace.
  const active = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  if (active === id) res.cookies.delete(WORKSPACE_COOKIE);
  return res;
});
