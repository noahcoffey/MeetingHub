import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { and, count, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  actionItems,
  meetings,
  projectRelations,
  projects,
  type ProjectRelation,
  type ProjectRelationKind,
  type ProjectStatus,
} from "@/db/schema";

// `db` or a transaction handle — the two share the query-builder surface these
// functions use, so a helper can run inside or outside a transaction.
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// The two "flow" kinds. Only these are cycle-constrained: a mutual `related`
// pair is meaningful, and `spun_from` is historical record, not a constraint.
const FLOW_KINDS: ProjectRelationKind[] = ["blocks", "depends_on"];

// Normalize a flow edge to a single direction so blocks(A,B) and depends_on(B,A)
// are recognized as the same arrow A -> B. Non-flow kinds return null.
function flowArrow(e: {
  fromId: string;
  toId: string;
  kind: ProjectRelationKind;
}): { from: string; to: string } | null {
  if (e.kind === "blocks") return { from: e.fromId, to: e.toId };
  if (e.kind === "depends_on") return { from: e.toId, to: e.fromId };
  return null;
}

// Edges have no workspace column — they inherit scope from their endpoints.
// Both endpoints are same-workspace (addRelation rejects mixed edges), so
// joining on the fromId side and filtering that is sufficient.
export async function listRelationEdges(
  workspaceId: string,
  executor: Executor = db,
): Promise<
  {
    id: string;
    fromId: string;
    toId: string;
    kind: ProjectRelationKind;
  }[]
> {
  return executor
    .select({
      id: projectRelations.id,
      fromId: projectRelations.fromId,
      toId: projectRelations.toId,
      kind: projectRelations.kind,
    })
    .from(projectRelations)
    .innerJoin(projects, eq(projectRelations.fromId, projects.id))
    .where(eq(projects.workspaceId, workspaceId));
}

export type RelationForProject = {
  id: string;
  kind: ProjectRelationKind;
  note: string | null;
  // Which side of the edge the *other* project sits on. "out" = this project is
  // fromId (this blocks that); "in" = this project is toId.
  direction: "out" | "in";
  otherId: string;
  otherName: string;
  otherStatus: ProjectStatus;
  createdInMeetingId: string | null;
  createdInMeetingTitle: string | null;
};

// Every edge touching this project, in both directions, with the other end's
// name/status and the provenance meeting's title joined in (no N+1 for callers).
export async function listRelationsForProject(
  projectId: string,
): Promise<RelationForProject[]> {
  const fromProject = alias(projects, "from_project");
  const toProject = alias(projects, "to_project");
  const rows = await db
    .select({
      id: projectRelations.id,
      fromId: projectRelations.fromId,
      toId: projectRelations.toId,
      kind: projectRelations.kind,
      note: projectRelations.note,
      createdInMeetingId: projectRelations.createdInMeetingId,
      createdInMeetingTitle: meetings.title,
      fromName: fromProject.name,
      fromStatus: fromProject.status,
      toName: toProject.name,
      toStatus: toProject.status,
    })
    .from(projectRelations)
    .innerJoin(fromProject, eq(projectRelations.fromId, fromProject.id))
    .innerJoin(toProject, eq(projectRelations.toId, toProject.id))
    .leftJoin(meetings, eq(projectRelations.createdInMeetingId, meetings.id))
    .where(
      or(
        eq(projectRelations.fromId, projectId),
        eq(projectRelations.toId, projectId),
      ),
    );

  return rows.map((r) => {
    const outgoing = r.fromId === projectId;
    return {
      id: r.id,
      kind: r.kind,
      note: r.note,
      direction: outgoing ? ("out" as const) : ("in" as const),
      otherId: outgoing ? r.toId : r.fromId,
      otherName: outgoing ? r.toName : r.fromName,
      otherStatus: outgoing ? r.toStatus : r.fromStatus,
      createdInMeetingId: r.createdInMeetingId,
      createdInMeetingTitle: r.createdInMeetingTitle,
    };
  });
}

// Can `from` reach `to` by walking normalized flow arrows forward? If so, adding
// from -> to as a flow edge would close a cycle.
function canReach(
  from: string,
  to: string,
  arrows: { from: string; to: string }[],
): boolean {
  const queue = [from];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const a of arrows) {
      if (a.from === current) queue.push(a.to);
    }
  }
  return false;
}

export type RelationFailure =
  | "self"
  | "not-found"
  | "duplicate"
  | "cycle"
  | "cross-workspace";

export type AddRelationResult =
  | { ok: true; relation: ProjectRelation }
  | { ok: false; reason: RelationFailure };

// Workspace-scoped flow arrows, excluding one edge id (used when re-checking an
// edge whose kind is being changed — its own old arrow must not block it).
async function flowArrowsForWorkspace(
  workspaceId: string,
  excludeId?: string,
): Promise<{ from: string; to: string }[]> {
  const edges = await listRelationEdges(workspaceId);
  return edges
    .filter((e) => e.id !== excludeId)
    .map(flowArrow)
    .filter((a): a is { from: string; to: string } => a !== null);
}

// Postgres unique-violation. The pair index (migration 0038) is the only thing
// standing between two racing requests and a double edge, so a violation means
// "someone else just made this connection", not a server fault.
// Drizzle wraps driver errors, so the code can be one level down in `cause`.
function isUniqueViolation(e: unknown): boolean {
  const code = (x: unknown) =>
    typeof x === "object" && x !== null
      ? (x as { code?: unknown }).code
      : undefined;
  return (
    code(e) === "23505" ||
    code((e as { cause?: unknown } | null)?.cause) === "23505"
  );
}

export async function addRelation(
  input: {
    fromId: string;
    toId: string;
    kind?: ProjectRelationKind;
    note?: string | null;
    createdInMeetingId?: string | null;
  },
  // Lets captureRelatedProject run the project insert and this edge in one
  // transaction instead of compensating afterwards.
  executor: Executor = db,
): Promise<AddRelationResult> {
  const { fromId, toId } = input;
  const kind = input.kind ?? "related";
  if (fromId === toId) return { ok: false, reason: "self" };

  const found = await executor
    .select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(inArray(projects.id, [fromId, toId]));
  if (found.length !== 2) return { ok: false, reason: "not-found" };
  if (found[0].workspaceId !== found[1].workspaceId) {
    return { ok: false, reason: "cross-workspace" };
  }
  const workspaceId = found[0].workspaceId;

  const edges = await listRelationEdges(workspaceId, executor);
  // One line per pair, whichever way it was drawn — flipping direction or
  // changing the kind goes through updateRelation, so the map never stacks two
  // edges between the same two bubbles.
  if (
    edges.some(
      (e) =>
        (e.fromId === fromId && e.toId === toId) ||
        (e.fromId === toId && e.toId === fromId),
    )
  ) {
    return { ok: false, reason: "duplicate" };
  }

  if (FLOW_KINDS.includes(kind)) {
    const arrow = flowArrow({ fromId, toId, kind });
    const arrows = edges
      .map(flowArrow)
      .filter((a): a is { from: string; to: string } => a !== null);
    // Adding from -> to closes a cycle iff to can already reach from.
    if (arrow && canReach(arrow.to, arrow.from, arrows)) {
      return { ok: false, reason: "cycle" };
    }
  }

  try {
    const [relation] = await executor
      .insert(projectRelations)
      .values({
        fromId,
        toId,
        kind,
        note: input.note?.trim() ? input.note.trim() : null,
        createdInMeetingId: input.createdInMeetingId ?? null,
      })
      .returning();
    return { ok: true, relation };
  } catch (e) {
    // Lost a race against an identical (or mirrored) insert.
    if (isUniqueViolation(e)) return { ok: false, reason: "duplicate" };
    throw e;
  }
}

export type UpdateRelationResult =
  | { ok: true; relation: ProjectRelation }
  | { ok: false; reason: "not-found" | "cycle" };

export async function updateRelation(
  id: string,
  patch: { kind?: ProjectRelationKind; note?: string | null },
): Promise<UpdateRelationResult> {
  const [existing] = await db
    .select()
    .from(projectRelations)
    .where(eq(projectRelations.id, id))
    .limit(1);
  if (!existing) return { ok: false, reason: "not-found" };

  if (patch.kind !== undefined && FLOW_KINDS.includes(patch.kind)) {
    const [owner] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, existing.fromId))
      .limit(1);
    if (!owner) return { ok: false, reason: "not-found" };
    const arrow = flowArrow({
      fromId: existing.fromId,
      toId: existing.toId,
      kind: patch.kind,
    });
    // Exclude this edge's own current arrow — retyping it must not trip over itself.
    const arrows = await flowArrowsForWorkspace(owner.workspaceId, id);
    if (arrow && canReach(arrow.to, arrow.from, arrows)) {
      return { ok: false, reason: "cycle" };
    }
  }

  const set: { kind?: ProjectRelationKind; note?: string | null } = {};
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.note !== undefined) {
    set.note = patch.note?.trim() ? patch.note.trim() : null;
  }
  const [relation] = await db
    .update(projectRelations)
    .set(set)
    .where(eq(projectRelations.id, id))
    .returning();
  return { ok: true, relation };
}

export async function getRelation(
  id: string,
): Promise<ProjectRelation | undefined> {
  const [row] = await db
    .select()
    .from(projectRelations)
    .where(eq(projectRelations.id, id))
    .limit(1);
  return row;
}

export async function removeRelation(id: string): Promise<void> {
  await db.delete(projectRelations).where(eq(projectRelations.id, id));
}

export type MapNode = {
  id: string;
  name: string;
  status: ProjectStatus;
  deadline: string | null; // colours the bubble on the graph surfaces
  hop: number; // 0 = the centre project
};

export type MapEdge = {
  id: string;
  fromId: string;
  toId: string;
  kind: ProjectRelationKind;
  note: string | null;
  createdInMeetingId: string | null;
  createdInMeetingTitle: string | null;
};

export type ProjectMap = {
  centreId: string;
  nodes: MapNode[];
  edges: MapEdge[];
  truncated: boolean;
};

// Guard rail: the radial layout stops being readable long before this, and a
// runaway graph shouldn't be able to stall the hub page.
const MAX_MAP_NODES = 60;

// BFS out from the centre over edges in both directions, `depth` hops deep.
export async function getProjectMap(
  projectId: string,
  opts?: { depth?: 1 | 2 },
): Promise<ProjectMap | null> {
  const depth = opts?.depth ?? 1;
  const [centre] = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      workspaceId: projects.workspaceId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!centre) return null;

  const all = await db
    .select({
      id: projectRelations.id,
      fromId: projectRelations.fromId,
      toId: projectRelations.toId,
      kind: projectRelations.kind,
      note: projectRelations.note,
      createdInMeetingId: projectRelations.createdInMeetingId,
      createdInMeetingTitle: meetings.title,
    })
    .from(projectRelations)
    .innerJoin(projects, eq(projectRelations.fromId, projects.id))
    .leftJoin(meetings, eq(projectRelations.createdInMeetingId, meetings.id))
    .where(eq(projects.workspaceId, centre.workspaceId));

  // Archived projects are excluded from the graph, matching getWorkspaceMap —
  // the map is for live work. The centre itself is always kept so a deep link
  // into an archived project's map still renders.
  const live = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, centre.workspaceId),
        inArray(projects.status, ["active", "parked"] as ProjectStatus[]),
      ),
    );
  const liveIds = new Set(live.map((r) => r.id));
  liveIds.add(centre.id);

  // Adjacency built once: the BFS previously rescanned every edge for every
  // frontier node, which is O(nodes x edges) on a busy workspace.
  const adjacency = new Map<string, string[]>();
  for (const e of all) {
    if (!liveIds.has(e.fromId) || !liveIds.has(e.toId)) continue;
    adjacency.set(e.fromId, [...(adjacency.get(e.fromId) ?? []), e.toId]);
    adjacency.set(e.toId, [...(adjacency.get(e.toId) ?? []), e.fromId]);
  }

  const hops = new Map<string, number>([[centre.id, 0]]);
  let frontier = [centre.id];
  let truncated = false;
  for (let h = 1; h <= depth; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of adjacency.get(id) ?? []) {
        if (hops.has(other)) continue;
        if (hops.size >= MAX_MAP_NODES) {
          truncated = true;
          continue;
        }
        hops.set(other, h);
        next.push(other);
      }
    }
    frontier = next;
  }

  const nodeRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      deadline: projects.deadline,
    })
    .from(projects)
    .where(inArray(projects.id, [...hops.keys()]));

  const nodes: MapNode[] = nodeRows
    .map((n) => ({ ...n, hop: hops.get(n.id) ?? 0 }))
    .sort((a, b) => a.hop - b.hop || a.name.localeCompare(b.name));

  // Only edges whose BOTH ends made it into the node set — no arrows into space.
  const edges: MapEdge[] = all.filter(
    (e) => hops.has(e.fromId) && hops.has(e.toId),
  );

  return { centreId: centre.id, nodes, edges, truncated };
}

// The map page's node carries enough for the side panel's header to render
// with no extra round trip; the panel fetches tasks lazily on selection.
export type WorkspaceMapNode = MapNode & {
  openTasks: number;
};

// Every project in the workspace plus every edge between them — the standalone
// /map page. Archived projects are left out: the map is for live work.
export async function getWorkspaceMap(workspaceId: string): Promise<{
  nodes: WorkspaceMapNode[];
  edges: MapEdge[];
}> {
  const [nodeRows, edges, openCounts] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        deadline: projects.deadline,
      })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          inArray(projects.status, ["active", "parked"] as ProjectStatus[]),
        ),
      )
      .orderBy(projects.name),
    db
      .select({
        id: projectRelations.id,
        fromId: projectRelations.fromId,
        toId: projectRelations.toId,
        kind: projectRelations.kind,
        note: projectRelations.note,
        createdInMeetingId: projectRelations.createdInMeetingId,
        createdInMeetingTitle: meetings.title,
      })
      .from(projectRelations)
      .innerJoin(projects, eq(projectRelations.fromId, projects.id))
      .leftJoin(meetings, eq(projectRelations.createdInMeetingId, meetings.id))
      .where(eq(projects.workspaceId, workspaceId)),
    db
      .select({ projectId: actionItems.projectId, n: count() })
      .from(actionItems)
      .where(
        and(
          eq(actionItems.workspaceId, workspaceId),
          eq(actionItems.status, "open"),
          isNotNull(actionItems.projectId),
        ),
      )
      .groupBy(actionItems.projectId),
  ]);

  const openByProject = new Map<string, number>();
  for (const row of openCounts) {
    if (row.projectId) openByProject.set(row.projectId, row.n);
  }
  const ids = new Set(nodeRows.map((n) => n.id));
  return {
    // hop is recomputed client-side as the focused node changes.
    nodes: nodeRows.map((n) => ({
      ...n,
      hop: 0,
      openTasks: openByProject.get(n.id) ?? 0,
    })),
    // An archived endpoint drops out of `ids`, so its edges drop too rather
    // than drawing arrows into nothing.
    edges: edges.filter((e) => ids.has(e.fromId) && ids.has(e.toId)),
  };
}

// Count of edges touching a project — the hub tab's badge.
export async function countRelationsForProject(
  projectId: string,
): Promise<number> {
  const rows = await db
    .select({ id: projectRelations.id })
    .from(projectRelations)
    .where(
      or(
        eq(projectRelations.fromId, projectId),
        eq(projectRelations.toId, projectId),
      ),
    );
  return rows.length;
}

// Create a parked project already wired to an existing one — the mid-meeting
// capture path. Deliberately one operation: a half-finished capture that leaves
// an orphan parked project with no connection is worse than no capture at all.
export type CaptureResult =
  | { ok: true; project: { id: string; name: string }; relation: ProjectRelation }
  | { ok: false; reason: RelationFailure | "bad-meeting" };

export async function captureRelatedProject(input: {
  fromProjectId: string;
  name: string;
  kind?: ProjectRelationKind;
  note?: string | null;
  meetingId?: string | null;
}): Promise<CaptureResult> {
  const [from] = await db
    .select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, input.fromProjectId))
    .limit(1);
  if (!from) return { ok: false, reason: "not-found" };

  // Provenance must be a meeting in the same workspace as the project the edge
  // hangs off — scope comes from the row, never the active-workspace cookie.
  if (input.meetingId) {
    const [m] = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(
        and(
          eq(meetings.id, input.meetingId),
          eq(meetings.workspaceId, from.workspaceId),
        ),
      )
      .limit(1);
    if (!m) return { ok: false, reason: "bad-meeting" };
  }

  // One transaction, so a failed edge can't strand a disconnected parked
  // project. (A compensating delete would itself be able to fail.) The
  // discriminated union is carried out through a sentinel rather than a throw
  // so callers keep getting a reason instead of an exception.
  let failure: RelationFailure | null = null;
  let created: {
    project: { id: string; name: string };
    relation: ProjectRelation;
  } | null = null;
  try {
    created = await db.transaction(async (tx) => {
      const [project] = await tx
      .insert(projects)
        .values({
          workspaceId: from.workspaceId,
          name: input.name,
          status: "parked",
        })
        .returning({ id: projects.id, name: projects.name });

      const result = await addRelation(
        {
          fromId: from.id,
          toId: project.id,
          kind: input.kind ?? "related",
          note: input.note ?? null,
          createdInMeetingId: input.meetingId ?? null,
        },
        tx,
      );
      if (!result.ok) {
        failure = result.reason;
        // Throws; the catch below turns it back into a reason.
        tx.rollback();
      }
      return {
        project,
        relation: (result as { relation: ProjectRelation }).relation,
      };
    });
  } catch (e) {
    // Only swallow our own deliberate rollback — anything else is a real fault.
    if (failure === null) throw e;
  }

  if (failure !== null) return { ok: false, reason: failure };
  if (!created) return { ok: false, reason: "not-found" };
  return { ok: true, project: created.project, relation: created.relation };
}
