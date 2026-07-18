import type { NextAuthConfig } from "next-auth";

// Edge-safe config (no db / bcrypt). Shared by middleware and the full auth setup.
export const authConfig = {
  trustHost: true, // self-hosted behind Dokploy/Traefik, not Vercel
  // Sliding 30-day session, refreshed at most daily — stays signed in with normal
  // use, but an idle session expires (and re-auth is one passkey tap).
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  pages: { signIn: "/login" },
  callbacks: {
    // Route gating, the CSRF/Origin check, and CSP all live in middleware.ts
    // (the auth() wrapper), so this is a no-op.
    authorized() {
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        if (token.id) session.user.id = token.id as string;
        if (token.email) session.user.email = token.email;
      }
      return session;
    },
  },
  providers: [], // declared in auth.ts (Credentials needs db + bcrypt, not edge-safe)
} satisfies NextAuthConfig;
