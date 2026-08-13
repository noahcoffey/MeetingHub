import type { ProjectStatus } from "@/db/schema";

// What a project bubble's fill means on the two graph surfaces (/map and the
// project hub's Map tab). Status alone would only ever be a two-colour legend —
// the graph payload never contains archived projects — so the live states are
// folded in with the deadline the payload already carries.
export type ProjectGraphState =
  | "parked" // an idea, not a real initiative yet
  | "overdue" // deadline is in the past
  | "soon" // deadline within a week
  | "active" // in flight, nothing pressing
  | "archived"; // finished or abandoned — see the note on GRAPH_STATES

export const GRAPH_STATE_LABEL: Record<ProjectGraphState, string> = {
  parked: "Parked idea",
  overdue: "Overdue",
  soon: "Due soon",
  active: "Active",
  archived: "Archived",
};

// The order a legend reads in: most urgent first, the shelf last. `archived` is
// deliberately absent — the graphs are for live work and both queries filter it
// out. The one way an archived project reaches a graph is by deep-linking to
// its own hub Map tab, where `getProjectMap` keeps the centre whatever its
// status so the page still renders; that surface adds the state to its legend
// itself.
export const GRAPH_STATES: ProjectGraphState[] = [
  "overdue",
  "soon",
  "active",
  "parked",
];

// Whole days between two YYYY-MM-DD strings. UTC midnights on both sides, so
// this is calendar math and never trips over a DST boundary.
function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

// Today as YYYY-MM-DD in the *browser's* timezone. The graph surfaces are
// client components and the app is single-user, so the viewer's own day
// boundary is the right one — and it avoids shipping APP_TIMEZONE to the client
// just to colour a bubble.
export function todayLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Same urgency buckets the /projects runway uses (overdue / within a week /
// beyond), so a project reads the same colour wherever it's shown.
export function projectGraphState(
  status: ProjectStatus,
  deadline: string | null,
  today: string,
): ProjectGraphState {
  if (status === "archived") return "archived";
  if (status === "parked") return "parked";
  if (!deadline) return "active";
  const diff = daysBetween(today, deadline);
  if (diff < 0) return "overdue";
  if (diff <= 7) return "soon";
  return "active";
}
