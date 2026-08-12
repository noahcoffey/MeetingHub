import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { removeRelation, updateRelation } from "@/lib/project-relations";
import { projectRelationKindEnum } from "@/db/schema";
import type { ProjectRelationKind } from "@/db/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const KINDS = projectRelationKindEnum.enumValues;

function isKind(v: unknown): v is ProjectRelationKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

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
  const { kind, note } = (body ?? {}) as { kind?: unknown; note?: unknown };
  if (kind !== undefined && !isKind(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return NextResponse.json({ error: "invalid note" }, { status: 400 });
  }

  const result = await updateRelation(id, {
    ...(kind !== undefined ? { kind } : {}),
    ...(note !== undefined ? { note: note as string | null } : {}),
  });
  if (!result.ok) {
    if (result.reason === "not-found") {
      return NextResponse.json({ error: "relation not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "would create a circular dependency" },
      { status: 409 },
    );
  }
  return NextResponse.json({ relation: result.relation });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await removeRelation(id);
  return NextResponse.json({ ok: true });
});
