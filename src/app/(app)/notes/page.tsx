import Link from "next/link";
import { redirect } from "next/navigation";
import { listNotesWithAttachments, searchNoteSummaries } from "@/lib/notes";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import { APP_TIMEZONE } from "@/lib/dates";
import { NewNoteButton } from "./new-note-button";
import { NotesSearch } from "./notes-search";

export const dynamic = "force-dynamic";

function formatUpdated(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  // lib/search needs >= 2 chars to build a tsquery; below that, show the full list.
  const searching = query.length >= 2;
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "notes")) redirect("/");
  const workspaceId = workspace.id;
  const notes = searching
    ? await searchNoteSummaries(workspaceId, query)
    : await listNotesWithAttachments(workspaceId);

  return (
    <div className="page">
      <div className="day-toolbar">
        <div className="day-toolbar-id">
          <h1 className="page-title">Notes</h1>
          <p className="muted page-subtitle">
            Reference notes, tied to the projects and meetings they belong to.
          </p>
        </div>
        <div className="day-toolbar-controls">
          <NewNoteButton />
        </div>
      </div>

      <NotesSearch initialQuery={query} />

      {notes.length === 0 ? (
        <p className="muted empty">
          {searching ? (
            <>No notes match &ldquo;{query}&rdquo;.</>
          ) : (
            <>No notes yet.</>
          )}
        </p>
      ) : (
        <ul className="notes-index">
          {notes.map((n) => (
            <li key={n.id}>
              <Link href={`/notes/${n.id}`} className="note-row">
                <span className="note-row-title">{n.title || "Untitled"}</span>
                <span className="note-row-meta">
                  {n.projects.map((p) => (
                    <span key={p.id} className="note-chip">
                      {p.name}
                    </span>
                  ))}
                  {n.meetingCount > 0 && (
                    <span className="note-chip note-chip-meeting">
                      {n.meetingCount === 1
                        ? "1 meeting"
                        : `${n.meetingCount} meetings`}
                    </span>
                  )}
                  <span className="note-row-updated">
                    Updated {formatUpdated(n.updatedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
