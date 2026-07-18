import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deletePerson, updatePerson } from "@/lib/people";

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
  const { name, email } = (body ?? {}) as { name?: unknown; email?: unknown };

  const patch: { name?: string; email?: string | null } = {};
  if (typeof name === "string" && name.trim() !== "") patch.name = name.trim();
  if (email === null) patch.email = null;
  else if (typeof email === "string") patch.email = email.trim() || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  try {
    const person = await updatePerson(id, patch);
    if (!person) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ person });
  } catch {
    return NextResponse.json(
      { error: "a person with that email already exists" },
      { status: 400 },
    );
  }
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await deletePerson(id);
  return NextResponse.json({ ok: true });
});
