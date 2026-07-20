import { redirect } from "next/navigation";
import { getOauthClient } from "@/lib/oauth";
import { listWorkspaces } from "@/lib/workspaces";
import { ConsentForm } from "./consent-form";

// OAuth consent screen for the MCP connector. Session-gated by the middleware
// like every other page — an unauthenticated hit bounces through /login and
// returns here with the full query string intact.

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Connection request</h1>
        <p className="login-error" role="alert">
          {message}
        </p>
      </div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const clientId = one(sp.client_id);
  const redirectUri = one(sp.redirect_uri);
  const oauthState = one(sp.state);

  // Errors we can't safely bounce back to the client land on an error card
  // (never redirect to an unverified URI).
  const client = clientId ? await getOauthClient(clientId).catch(() => undefined) : undefined;
  if (!client) {
    return <ErrorCard message="Unknown client. The connecting app sent an invalid client_id." />;
  }
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return <ErrorCard message="The connecting app sent a redirect URL it didn't register." />;
  }

  // Redirect URI is verified — remaining protocol errors go back per RFC 6749.
  const bounce = (error: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    if (oauthState) url.searchParams.set("state", oauthState);
    redirect(url.toString());
  };

  const codeChallenge = one(sp.code_challenge);
  if (one(sp.response_type) !== "code") bounce("unsupported_response_type");
  if (
    !codeChallenge ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge) ||
    (one(sp.code_challenge_method) ?? "S256") !== "S256"
  ) {
    bounce("invalid_request");
  }

  const requestedScope = one(sp.scope) ?? "";
  const workspaces = (await listWorkspaces()).map((w) => ({
    id: w.id,
    name: w.name,
  }));

  const denyUrl = new URL(redirectUri);
  denyUrl.searchParams.set("error", "access_denied");
  if (oauthState) denyUrl.searchParams.set("state", oauthState);

  return (
    <main className="login-page">
      <div className="login-card consent-card">
        <h1>Connect “{client.name}”</h1>
        <p className="muted">
          This app is asking for API access to your Meeting Hub. Approving
          creates an API token you can revoke any time under Settings → API
          tokens.
        </p>
        <ConsentForm
          clientId={client.id}
          redirectUri={redirectUri}
          oauthState={oauthState ?? ""}
          codeChallenge={codeChallenge!}
          defaultScope={/\bwrite\b/.test(requestedScope) ? "write" : "read"}
          workspaces={workspaces}
          denyUrl={denyUrl.toString()}
        />
      </div>
    </main>
  );
}
