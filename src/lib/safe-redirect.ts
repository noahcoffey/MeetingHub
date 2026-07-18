// Only allow same-origin, relative paths as a post-login redirect target — never
// an absolute or protocol-relative URL. Guards against open-redirect / phishing
// via ?callbackUrl=. Kept dependency-free so the client login form can use it.
export function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return "/";
  // Must start with a single "/". Reject "//evil.com" and "/\evil.com"
  // (browsers treat backslash as a slash), and anything carrying a scheme/host.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  return raw;
}
