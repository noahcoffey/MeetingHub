// Dedicated E2E database + a real Next dev server on its own port, so the
// browser flow never touches dev data. Kept self-contained (no @/ alias, no
// src imports) so tsx runs setup-db.ts without tsconfig-path resolution.
export const E2E_DATABASE_URL =
  "postgres://meetinghub:meetinghub@localhost:5432/meetinghub_e2e";
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_AUTH_SECRET = "e2e-only-not-a-real-secret-0123456789";

// The single seeded user's password — typed into the login form by the spec.
export const E2E_EMAIL = "e2e@example.com";
export const E2E_PASSWORD = "e2e-test-password-123";
