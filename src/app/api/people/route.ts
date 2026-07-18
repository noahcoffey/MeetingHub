import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createPerson, listPeople } from "@/lib/people";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const workspaceId = await getActiveWorkspaceId();
  return NextResponse.json({ people: await listPeople(workspaceId) });
});

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
  const { name, email } = (body ?? {}) as { name?: unknown; email?: unknown };
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const workspaceId = await getActiveWorkspaceId();
    const person = await createPerson(workspaceId, {
      name: name.trim(),
      email: typeof email === "string" && email.trim() !== "" ? email : null,
    });
    return NextResponse.json({ person }, { status: 201 });
  } catch {
    // Unique violation — email already belongs to another person.
    return NextResponse.json(
      { error: "a person with that email already exists" },
      { status: 400 },
    );
  }
});
