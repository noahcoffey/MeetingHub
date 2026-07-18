import { NextResponse } from "next/server";
import { listWorkspaces } from "@/lib/workspaces";
import { isWorkspaceAllowed, withV1 } from "../_lib/helpers";

export const dynamic = "force-dynamic";

// The workspaces this token can reach — the ids other endpoints take as
// ?workspace=.
export const GET = withV1({}, async (_req, _ctx, principal) => {
  const items = (await listWorkspaces())
    .filter((w) => isWorkspaceAllowed(principal, w.id))
    .map((w) => ({
      id: w.id,
      name: w.name,
      isDefault: w.isDefault,
      disabledFeatures: w.disabledFeatures,
    }));
  return NextResponse.json({ items });
});
