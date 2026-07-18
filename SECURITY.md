# Security

Meeting Hub is a **self-hosted, single-user** app. Each instance has exactly one
trusted user who owns all data; the workspace partition is a UI convenience, not
a security boundary. This document describes the security model, the hardening in
place, and what a deployer must configure.

## Reporting a vulnerability

Please report security issues privately via GitHub's **Report a vulnerability**
(Security → Advisories) rather than a public issue.

## Authentication

- **Passwordless-first.** Register a passkey (WebAuthn) and sign in with one tap;
  registering the first passkey disables password login and mints 10 one-time
  recovery codes. Passkeys are the recommended primary method.
- **Password** login (bcrypt, cost 12) and **recovery codes** (bcrypt-hashed,
  single-use, atomically consumed) are fallbacks.
- **Break-glass:** `npm run auth:reset` (host-only, needs `DATABASE_URL`) clears
  passkeys/codes and re-enables password login. There is no remote reset route.
- Passkeys are verified with `requireUserVerification: false` so security keys
  without a PIN/biometric still work. Deployers wanting to require user
  verification can set it to `true` in `src/auth.ts` and the WebAuthn options —
  note this can reject authenticators that can't perform UV.

## Login throttling & the trusted-proxy requirement

Failed logins are rate-limited per client IP (5 fails / 15 min → 15 min lockout),
with a global backstop (50 fails / 15 min) against IP rotation. The client IP is
derived from `X-Forwarded-For` using **`TRUSTED_PROXY_COUNT`** (default `1`):

- **Behind a reverse proxy (recommended, e.g. Traefik):** set it to the number of
  proxies that append to XFF (usually `1`). The real client IP is taken that many
  hops from the right; anything further left is client-controlled and ignored.
- **Directly exposed (no proxy):** set `TRUSTED_PROXY_COUNT=0`. XFF is then
  untrusted (spoofable), so per-IP throttling can't be trusted and only the global
  backstop applies. **Deploy behind a proxy that sets XFF for real per-IP
  throttling.**

A consequence of the global backstop: an unauthenticated attacker can send ~50 bad
passwords to lock out **password and recovery** login for 15 minutes (repeatable).
**Passkey login is never throttled**, so this does not lock out a passkey user —
another reason to prefer passkeys.

## Secrets

- `AUTH_SECRET` signs session JWTs **and** (via a distinct scrypt derivation)
  encrypts stored Google refresh tokens. Use a strong value
  (`openssl rand -base64 32`); rotating it invalidates sessions and stored Google
  tokens (accounts simply re-connect).
- Google refresh tokens are stored **encrypted at rest** (AES-256-GCM).
- API tokens (`mh_…`) are shown once; only a SHA-256 hash is stored. Revocation is
  immediate.
- No secrets are committed; `.env*` is git-ignored and excluded from the Docker
  build context.

## APIs

- **`/api/v1`** requires a scoped bearer token (`read`/`write`, optional workspace
  restriction, optional expiry). By-id endpoints return **404** for rows outside a
  token's workspaces (no existence leak). Bodies are capped at 1 MB.
- **`POST /api/ingest`** uses the static `INGEST_API_KEY` (constant-time compared).
  This key grants **app-wide write of generated notes** to any meeting by id — treat
  it as a privileged credential and set only if you use the ingest integration.
- **Public docs:** `/api-docs.html` and `/openapi.yaml` are served without auth.
  They contain no secrets — only the API *documentation* is public; every endpoint
  stays token-gated.

## Network / SSRF

Server-side fetches of user-supplied URLs (the workspace ICS feed) are guarded:
non-`http(s)` schemes and internal/private/link-local hosts are rejected, redirects
are followed manually with the same checks on each hop (DNS-rebind defense), and
the response size is capped. If deploying where SSRF to an internal service would
be catastrophic, also restrict egress at the network layer.

## Transport & headers

HTTPS is required in production (the session cookie is `Secure`). Responses carry
HSTS (`includeSubDomains`, no `preload` by default), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
`Cross-Origin-Opener-Policy: same-origin`, and a strict per-request nonce +
`strict-dynamic` Content-Security-Policy (production only).

## Google OAuth

The connect flow uses a CSRF `state` cookie; all Google hosts are fixed. In
production, set **`GOOGLE_REDIRECT_URI`** explicitly rather than relying on the
request origin (which a spoofed `Host` header behind a misconfigured proxy could
otherwise influence).

## If you make it multi-user

The internal (session-cookie) `/api/*` routes resolve the active workspace from a
cookie and don't re-check each row's workspace — safe only because one user owns
everything. Before supporting multiple users, apply the `/api/v1` layer's
`checkRowWorkspace`-style guard to every internal by-id route.
