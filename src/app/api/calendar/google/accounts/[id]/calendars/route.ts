import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRefreshToken } from "@/lib/google-accounts";
import { listCalendars } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The calendars a connected account can read — for the per-workspace picker.
export const GET = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const refreshToken = await getRefreshToken(id);
  if (!refreshToken) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const calendars = await listCalendars(refreshToken);
    return NextResponse.json({ calendars });
  } catch {
    return NextResponse.json(
      { error: "Could not list calendars." },
      { status: 502 },
    );
  }
});
