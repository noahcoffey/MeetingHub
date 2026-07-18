import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import {
  AUTH_CHALLENGE_COOKIE,
  getSingleUser,
  listCredentials,
  rpInfo,
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

// Public (excluded from the middleware matcher): the user isn't logged in yet.
export async function GET(req: Request) {
  const { rpID } = rpInfo(req);
  const user = await getSingleUser();
  const creds = user ? await listCredentials(user.id) : [];

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: c.transports as Transports,
    })),
    userVerification: "preferred",
  });

  const res = NextResponse.json(options);
  res.cookies.set(AUTH_CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
  });
  return res;
}
