import {
  todayInAppTz,
  isValidDateParam,
  formatPrettyDateStr,
  formatDateInTz,
  APP_TIMEZONE,
} from "@/lib/dates";
import { getOrCreateEntry } from "@/lib/journal";
import { listStats, getEntryValues } from "@/lib/journal-stats";
import { listOpenActionItems } from "@/lib/action-items";
import { listProjects } from "@/lib/projects";
import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import { SaveStatusProvider, SaveIndicator } from "../save-status";
import { DateNav } from "../date-nav";
import { ActionItemsList } from "../action-items-list";
import { toClientItem, type ClientItem } from "../action-item-mapper";
import { RailResizeHandle, RailToggle } from "../chrome";
import { JournalNotes } from "./journal-notes";
import { JournalRail } from "./journal-rail";
import { JournalMeta } from "./journal-meta";

export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date = isValidDateParam(dateParam) ? dateParam : todayInAppTz();
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "journal")) redirect("/");
  const workspaceId = workspace.id;
  const entry = await getOrCreateEntry(workspaceId, date);

  const [open, projects, stats, values] = await Promise.all([
    listOpenActionItems(workspaceId),
    listProjects(workspaceId),
    listStats(workspaceId),
    getEntryValues(entry.id),
  ]);
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const clientItems: ClientItem[] = open.map(toClientItem);
  const statItems = stats.map((s) => {
    const v = values.get(s.id);
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      direction: s.direction,
      config: s.config,
      numValue: v?.numValue ?? null,
      textValue: v?.textValue ?? null,
    };
  });

  return (
    <div className="meeting-workspace">
      {/* key by entry so editors/meta remount (reset content) when the date changes */}
      <SaveStatusProvider key={entry.id}>
        <section className="notes-pane">
          <div className="notes-pane-head">
            <div className="notes-col">
              <header className="detail-header">
                <div className="detail-title-row">
                  <h1 className="page-title">{formatPrettyDateStr(date)}</h1>
                  <SaveIndicator />
                </div>
                <div className="journal-head-row">
                  <span className="journal-eyebrow">Journal</span>
                  <DateNav date={date} basePath="/journal" />
                </div>
              </header>
            </div>
          </div>
          <div className="notes-stack">
            <section className="nsec open journal-nsec">
              <div className="nsec-body">
                <div className="notes-col">
                  <JournalNotes
                    entryId={entry.id}
                    initialNotes={entry.notes}
                    initialNotesUpdatedAt={new Date(
                      entry.notesUpdatedAt,
                    ).toISOString()}
                  />
                </div>
              </div>
            </section>
          </div>
        </section>

        <aside className="actions-rail">
          <RailResizeHandle />
          <RailToggle />
          <JournalRail
            meta={
              <JournalMeta entryId={entry.id} stats={statItems} />
            }
          >
            <ActionItemsList
              currentJournalEntryId={entry.id}
              today={todayInAppTz()}
              initialItems={clientItems}
              projects={projectOptions}
            />
          </JournalRail>
        </aside>
      </SaveStatusProvider>
    </div>
  );
}
