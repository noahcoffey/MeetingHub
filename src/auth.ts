import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { authConfig } from "@/auth.config";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  ipFromHeaders,
  loginLockMs,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-throttle";
import {
  AUTH_CHALLENGE_COOKIE,
  consumeRecoveryCode,
  getCredential,
  getSingleUser,
  getUserById,
  readCookie,
  rpInfo,
  updateCredentialCounter,
} from "@/lib/webauthn";

// Throttle key is derived server-side from request headers only — never from a
// client-supplied value (that would let a caller pick its own throttle bucket).
function clientIp(request: Request | undefined): string {
  return request ? ipFromHeaders(request.headers) : "unknown";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      // Password login — only allowed while password_enabled (off once a passkey exists).
      credentials: {
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const password = credentials?.password;
        if (typeof password !== "string" || password.length === 0) return null;

        const ip = clientIp(request);
        if (loginLockMs(ip) > 0) return null;

        const [user] = await db.select().from(users).limit(1);
        if (!user || !user.passwordEnabled) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          recordLoginFailure(ip);
          return null;
        }
        recordLoginSuccess(ip);
        return { id: user.id, email: user.email };
      },
    }),

    Credentials({
      id: "passkey",
      name: "Passkey",
      credentials: { response: { type: "text" } },
      authorize: async (credentials, request) => {
        if (!request) return null;
        const raw = credentials?.response;
        if (typeof raw !== "string") return null;

        let assertion;
        try {
          assertion = JSON.parse(raw);
        } catch {
          return null;
        }
        const challenge = readCookie(request, AUTH_CHALLENGE_COOKIE);
        if (!challenge || typeof assertion?.id !== "string") return null;

        const cred = await getCredential(assertion.id);
        if (!cred) return null;

        const { rpID, origin } = rpInfo(request);
        try {
          const verification = await verifyAuthenticationResponse({
            response: assertion,
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
              id: cred.credentialId,
              publicKey: new Uint8Array(
                Buffer.from(cred.publicKey, "base64url"),
              ),
              counter: cred.counter,
              transports: cred.transports as (
                | "ble"
                | "cable"
                | "hybrid"
                | "internal"
                | "nfc"
                | "smart-card"
                | "usb"
              )[],
            },
            requireUserVerification: false,
          });
          if (!verification.verified) return null;
          await updateCredentialCounter(
            cred.credentialId,
            verification.authenticationInfo.newCounter,
          );
        } catch {
          return null;
        }

        const user = await getUserById(cred.userId);
        return user ? { id: user.id, email: user.email } : null;
      },
    }),

    Credentials({
      id: "recovery",
      name: "Recovery code",
      credentials: {
        code: { label: "Recovery code", type: "text" },
      },
      authorize: async (credentials, request) => {
        const code = credentials?.code;
        if (typeof code !== "string" || !code.trim()) return null;

        const ip = clientIp(request);
        if (loginLockMs(ip) > 0) return null;

        const user = await getSingleUser();
        if (!user) return null;

        const ok = await consumeRecoveryCode(user.id, code);
        if (!ok) {
          recordLoginFailure(ip);
          return null;
        }
        recordLoginSuccess(ip);
        return { id: user.id, email: user.email };
      },
    }),
  ],
});
