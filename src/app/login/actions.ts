"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { ipFromHeaders, loginLockMs } from "@/lib/login-throttle";

function lockedMessage(ms: number): string {
  const mins = Math.ceil(ms / 60_000);
  return `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const ip = ipFromHeaders(await headers());

  const lockMs = loginLockMs(ip);
  if (lockMs > 0) return lockedMessage(lockMs);

  try {
    await signIn("credentials", {
      password: formData.get("password"),
      clientIp: ip,
      redirectTo: "/",
    });
  } catch (error) {
    // signIn throws a redirect on success — let that propagate.
    if (error instanceof AuthError) {
      // This attempt may have just tripped the lockout.
      const after = loginLockMs(ip);
      if (after > 0) return lockedMessage(after);
      return "Incorrect password, or password sign-in is disabled.";
    }
    throw error;
  }
  return undefined;
}

export async function authenticateRecovery(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const ip = ipFromHeaders(await headers());

  const lockMs = loginLockMs(ip);
  if (lockMs > 0) return lockedMessage(lockMs);

  try {
    await signIn("recovery", {
      code: formData.get("code"),
      clientIp: ip,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const after = loginLockMs(ip);
      if (after > 0) return lockedMessage(after);
      return "Invalid or already-used recovery code.";
    }
    throw error;
  }
  return undefined;
}
