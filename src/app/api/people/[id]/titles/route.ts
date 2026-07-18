import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addLinkedTitle, getPerson } from "@/lib/people";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = auth(async (req, ctx) => {
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
  const { title } = (body ?? {}) as { title?: unknown };
  if (typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!(await getPerson(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await addLinkedTitle(id, title.trim());
  return NextResponse.json({ ok: true }, { status: 201 });
});
