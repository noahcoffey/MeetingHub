import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { auth } from "@/auth";
import {
  countCredentials,
  generateRecoveryCodes,
  insertCredential,
  readCookie,
  REG_CHALLENGE_COOKIE,
  rpInfo,
  setPasswordEnabled,
} from "@/lib/webauthn";

export const dynamic = "force-dynamic";

function defaultName(transports: string[]): string {
  if (transports.includes("internal")) return "This device";
  if (transports.includes("usb") || transports.includes("nfc"))
    return "Security key";
  return "Passkey";
}

export const POST = auth(async (req) => {
  const userId = req.auth?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const challenge = readCookie(req, REG_CHALLENGE_COOKIE);
  if (!challenge) {
    return NextResponse.json({ error: "no challenge" }, { status: 400 });
  }

  let body: { response?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.response) {
    return NextResponse.json({ error: "missing response" }, { status: 400 });
  }

  const { rpID, origin } = rpInfo(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      // @simplewebauthn validates the shape at runtime
      response: body.response as Parameters<
        typeof verifyRegistrationResponse
      >[0]["response"],
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch {
    return NextResponse.json({ verified: false }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ verified: false }, { status: 400 });
  }

  // v10+ groups these under registrationInfo.credential; id is already base64url.
  const { id, publicKey, counter } = verification.registrationInfo.credential;
  const transports: string[] =
    verification.registrationInfo.credential.transports ??
    (body.response as { response?: { transports?: string[] } })?.response
      ?.transports ??
    [];
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : defaultName(transports);

  await insertCredential({
    userId,
    credentialId: id,
    publicKey: Buffer.from(publicKey).toString("base64url"),
    counter,
    transports,
    name,
  });

  // First passkey: disable password login and mint recovery codes (shown once).
  let recovery: string[] | undefined;
  if ((await countCredentials(userId)) === 1) {
    await setPasswordEnabled(userId, false);
    recovery = await generateRecoveryCodes(userId);
  }

  const res = NextResponse.json({ verified: true, recovery });
  res.cookies.delete(REG_CHALLENGE_COOKIE);
  return res;
});
