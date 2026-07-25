// The externally-visible origin of a request. In the standalone Docker build
// `new URL(req.url).origin` resolves to the container bind address
// (e.g. https://0.0.0.0:3000), so anything that round-trips an absolute URL
// through the browser (OAuth redirect URIs, post-consent redirects) must
// derive the origin from the proxy-forwarded headers instead — same trust
// model as rpInfo() in lib/webauthn.ts, which already works in production.
// Structural param ({ headers }) for the same reason as rpInfo: mcp-handler
// augments the global Request type.
export function requestOrigin(request: { headers: Headers }): string {
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}
