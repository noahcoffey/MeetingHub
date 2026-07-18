import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { auth } from "@/auth";
import {
  listCredentials,
  rpInfo,
  REG_CHALLENGE_COOKIE,
} from "@/lib/webauthn";

export const dynamic = "force-dynamic";

type Transports = (
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb"
)[];

export const GET = auth(async (req) => {
  const userId = req.auth?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { rpID } = rpInfo(req);
  const existing = await listCredentials(userId);

  const options = await generateRegistrationOptions({
    rpName: "Meeting Hub",
    rpID,
    userID: new TextEncoder().encode(userId),
    userName: req.auth?.user?.email ?? "user",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports as Transports,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const res = NextResponse.json(options);
  res.cookies.set(REG_CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
  });
  return res;
});
