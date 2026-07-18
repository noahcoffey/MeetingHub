import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspaceById } from "@/lib/workspaces";
import { WORKSPACE_COOKIE } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

const ONE_YEAR = 60 * 60 * 24 * 365;

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

  const { id } = (body ?? {}) as { id?: unknown };
  if (typeof id !== "string" || id === "") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const w = await getWorkspaceById(id);
  if (!w) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return res;
});
