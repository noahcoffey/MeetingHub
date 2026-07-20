"use client";

import { useActionState, useEffect } from "react";
import { approve, type ApproveState } from "./actions";

export function ConsentForm(props: {
  clientId: string;
  redirectUri: string;
  oauthState: string;
  codeChallenge: string;
  defaultScope: "read" | "write";
  workspaces: { id: string; name: string }[];
  denyUrl: string;
}) {
  const [state, action, pending] = useActionState<ApproveState, FormData>(
    approve,
    null,
  );

  useEffect(() => {
    if (state && "redirectTo" in state) {
      window.location.assign(state.redirectTo);
    }
  }, [state]);

  const approved = state !== null && "redirectTo" in state;

  return (
    <form action={action} className="login-form">
      <input type="hidden" name="client_id" value={props.clientId} />
      <input type="hidden" name="redirect_uri" value={props.redirectUri} />
      <input type="hidden" name="state" value={props.oauthState} />
      <input type="hidden" name="code_challenge" value={props.codeChallenge} />

      <fieldset className="consent-group">
        <legend>Access level</legend>
        <label className="consent-option">
          <input
            type="radio"
            name="scope"
            value="read"
            defaultChecked={props.defaultScope === "read"}
          />
          <span>
            <strong>Read only</strong> — list and read meetings, tasks,
            projects, and notes
          </span>
        </label>
        <label className="consent-option">
          <input
            type="radio"
            name="scope"
            value="write"
            defaultChecked={props.defaultScope === "write"}
          />
          <span>
            <strong>Read &amp; write</strong> — also create and update them
          </span>
        </label>
      </fieldset>

      <fieldset className="consent-group">
        <legend>Workspaces</legend>
        <p className="consent-hint">
          Restrict access to selected workspaces — or leave all unchecked to
          allow every workspace.
        </p>
        {props.workspaces.map((w) => (
          <label key={w.id} className="consent-option">
            <input type="checkbox" name="workspaces" value={w.id} />
            <span>{w.name}</span>
          </label>
        ))}
      </fieldset>

      {state && "error" in state && (
        <p role="alert" className="login-error">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending || approved}>
        {approved ? "Redirecting…" : pending ? "Approving…" : "Approve"}
      </button>
      <a className="consent-deny" href={props.denyUrl}>
        Deny
      </a>
    </form>
  );
}
