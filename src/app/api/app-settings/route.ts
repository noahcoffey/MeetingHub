import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getHideGeneratedNotes,
  setHideGeneratedNotes,
} from "@/lib/app-settings";

export const dynamic = "force-dynamic";

export const PATCH = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { hideGeneratedNotes } = (body ?? {}) as {
    hideGeneratedNotes?: unknown;
  };
  if (typeof hideGeneratedNotes !== "boolean") {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  await setHideGeneratedNotes(hideGeneratedNotes);
  return NextResponse.json({
    hideGeneratedNotes: await getHideGeneratedNotes(),
  });
});
