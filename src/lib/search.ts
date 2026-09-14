import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { WorkspaceFeature } from "@/db/schema";

export type MeetingHit = {
  id: string;
  title: string;
  startTime: Date;
};
export type ActionHit = {
  id: string;
  content: string;
  meetingId: string | null;
  meetingTitle: string | null;
};
export type ProjectHit = {
  id: string;
  name: string;
  // Parked ideas are searchable (that's half the point of writing them down),
  // but the palette labels them so they aren't mistaken for real projects.
  parked: boolean;
};
export type NoteHit = {
  id: string;
  title: string;
};
// A day summary is a synthesis over a day's meetings, not a primary note, so it
// is its own result type — the palette gives it its own group and icon, and the
// subtitle names the day. Deliberately NOT deduplicated against its source
// meetings: a query can legitimately match both the synthesis and the notes it
// was written from, and the reader wants to choose which to open.
export type DaySummaryHit = {
  id: string;
  day: string;
};
export type SearchResults = {
  meetings: MeetingHit[];
  actions: ActionHit[];
  projects: ProjectHit[];
  notes: NoteHit[];
  daySummaries: DaySummaryHit[];
};

// Build a prefix tsquery from sanitized terms: "daily stand" -> "daily:* & stand:*".
// Prefix (:*) gives as-you-type matching; & requires all terms.
function buildTsQuery(q: string): string {
  const terms = q.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return terms.map((t) => `${t}:*`).join(" & ");
}

const MEETING_DOC = sql`to_tsvector('english',
  coalesce(title,'') || ' ' || coalesce(notes,'') || ' ' ||
  coalesce(notes_generated,'') || ' ' || coalesce(description,''))`;
// Variant for the Advanced "hide generated notes" toggle: generated notes
// shouldn't surface hidden content through search hits.
const MEETING_DOC_NO_GENERATED = sql`to_tsvector('english',
  coalesce(title,'') || ' ' || coalesce(notes,'') || ' ' ||
  coalesce(description,''))`;
const PROJECT_DOC = sql`to_tsvector('english',
  coalesce(name,'') || ' ' || coalesce(description,''))`;
const NOTE_DOC = sql`to_tsvector('english',
  coalesce(title,'') || ' ' || coalesce(notes,''))`;
// Search the body the day view actually renders: the hand-edited version when
// there is one, else the generated one.
const DAY_SUMMARY_DOC = sql`to_tsvector('english',
  coalesce(markdown_edited, markdown, ''))`;

// Notes-only search for the /notes page's dedicated search box. Same hybrid
// FTS-prefix + trigram ranking as the palette's note section, but with a page
// -sized limit instead of the palette's 8.
export async function searchNotes(
  workspaceId: string,
  query: string,
  limit = 50,
): Promise<{ id: string; title: string; updatedAt: Date }[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const tsq = buildTsQuery(q);
  if (!tsq) return [];

  const rows = (await db.execute(sql`
    SELECT id, title, updated_at
    FROM notes
    WHERE workspace_id = ${workspaceId}
      AND (${NOTE_DOC} @@ to_tsquery('english', ${tsq})
       OR ${q}::text <% title)
    ORDER BY GREATEST(
      ts_rank(${NOTE_DOC}, to_tsquery('english', ${tsq})),
      word_similarity(${q}::text, title)
    ) DESC, updated_at DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ id: string; title: string; updated_at: string }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: new Date(r.updated_at),
  }));
}

export async function search(
  workspaceId: string,
  query: string,
  opts?: { includeGenerated?: boolean; disabled?: WorkspaceFeature[] },
): Promise<SearchResults> {
  const meetingDoc =
    opts?.includeGenerated === false ? MEETING_DOC_NO_GENERATED : MEETING_DOC;
  const disabled = opts?.disabled ?? [];
  const meetingsEnabled = !disabled.includes("meetings");
  const projectsEnabled = !disabled.includes("projects");
  const notesEnabled = !disabled.includes("notes");
  const q = query.trim();
  const empty: SearchResults = {
    meetings: [],
    actions: [],
    projects: [],
    notes: [],
    daySummaries: [],
  };
  if (q.length < 2) return empty;
  const tsq = buildTsQuery(q);
  if (!tsq) return empty;

  // Hybrid: full-text (prefix) match OR trigram word-similarity (fuzzy/typo),
  // ranked by the best of ts_rank and word_similarity.
  const meetingRows = meetingsEnabled
    ? ((await db.execute(sql`
    SELECT id, title, start_time
    FROM meetings
    WHERE workspace_id = ${workspaceId}
      AND (${meetingDoc} @@ to_tsquery('english', ${tsq})
       OR ${q}::text <% title)
    ORDER BY GREATEST(
      ts_rank(${meetingDoc}, to_tsquery('english', ${tsq})),
      word_similarity(${q}::text, title)
    ) DESC, start_time DESC
    LIMIT 8
  `)) as unknown as Array<{ id: string; title: string; start_time: string }>)
    : [];

  const actionRows = (await db.execute(sql`
    SELECT a.id, a.content, a.meeting_id, m.title AS meeting_title
    FROM action_items a
    LEFT JOIN meetings m ON m.id = a.meeting_id
    WHERE a.workspace_id = ${workspaceId}
      AND (to_tsvector('english', coalesce(a.content,'')) @@ to_tsquery('english', ${tsq})
       OR ${q}::text <% a.content)
    ORDER BY GREATEST(
      ts_rank(to_tsvector('english', coalesce(a.content,'')), to_tsquery('english', ${tsq})),
      word_similarity(${q}::text, a.content)
    ) DESC
    LIMIT 8
  `)) as unknown as Array<{
    id: string;
    content: string;
    meeting_id: string | null;
    meeting_title: string | null;
  }>;

  const projectRows = projectsEnabled
    ? ((await db.execute(sql`
    SELECT id, name, status
    FROM projects
    WHERE workspace_id = ${workspaceId} AND status IN ('active', 'parked') AND (
      ${PROJECT_DOC} @@ to_tsquery('english', ${tsq})
      OR ${q}::text <% name
    )
    ORDER BY GREATEST(
      ts_rank(${PROJECT_DOC}, to_tsquery('english', ${tsq})),
      word_similarity(${q}::text, name)
    ) DESC
    LIMIT 8
  `)) as unknown as Array<{ id: string; name: string; status: string }>)
    : [];

  const noteRows = notesEnabled
    ? ((await db.execute(sql`
    SELECT id, title
    FROM notes
    WHERE workspace_id = ${workspaceId}
      AND (${NOTE_DOC} @@ to_tsquery('english', ${tsq})
       OR ${q}::text <% title)
    ORDER BY GREATEST(
      ts_rank(${NOTE_DOC}, to_tsquery('english', ${tsq})),
      word_similarity(${q}::text, title)
    ) DESC, updated_at DESC
    LIMIT 8
  `)) as unknown as Array<{ id: string; title: string }>)
    : [];

  // Gated on `meetings`, like the meetings group — a day summary aggregates
  // that day's meeting notes and must never be more findable than its sources.
  // No trigram arm: there is no short title to fuzzy-match, only a long body.
  const daySummaryRows = meetingsEnabled
    ? ((await db.execute(sql`
    SELECT id, day::text AS day
    FROM day_summaries
    WHERE workspace_id = ${workspaceId}
      AND status = 'ready'
      AND ${DAY_SUMMARY_DOC} @@ to_tsquery('english', ${tsq})
    ORDER BY ts_rank(${DAY_SUMMARY_DOC}, to_tsquery('english', ${tsq})) DESC,
      day DESC
    LIMIT 5
  `)) as unknown as Array<{ id: string; day: string }>)
    : [];

  return {
    daySummaries: daySummaryRows.map((r) => ({ id: r.id, day: r.day })),
    meetings: meetingRows.map((r) => ({
      id: r.id,
      title: r.title,
      startTime: new Date(r.start_time),
    })),
    actions: actionRows.map((r) => ({
      id: r.id,
      content: r.content,
      meetingId: r.meeting_id,
      meetingTitle: r.meeting_title,
    })),
    projects: projectRows.map((r) => ({
      id: r.id,
      name: r.name,
      parked: r.status === "parked",
    })),
    notes: noteRows.map((r) => ({ id: r.id, title: r.title })),
  };
}
