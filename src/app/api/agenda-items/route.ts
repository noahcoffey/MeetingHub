import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAgendaItem, getPerson } from "@/lib/people";

export const dynamic = "force-dynamic";

export const POST = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { personId, content } = (body ?? {}) as {
    personId?: unknown;
    content?: unknown;
  };
  if (typeof personId !== "string" || personId === "") {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }
  if (typeof content !== "string" || content.trim() === "") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (!(await getPerson(personId))) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }

  const item = await createAgendaItem(personId, content.trim());
  return NextResponse.json({ item }, { status: 201 });
});
