"use client";

import { useState } from "react";
import { ProjectPicker, type ProjectOption } from "../../project-picker";

// Tags a meeting to a project from the detail header. Optimistic like the notes
// autosave elsewhere in this page — reconciles on next load if the PATCH fails.
export function MeetingProjectPicker({
  meetingId,
  initialProjectId,
  projects,
  suggested = null,
}: {
  meetingId: string;
  initialProjectId: string | null;
  projects: ProjectOption[];
  suggested?: ProjectOption | null;
}) {
  const [projectId, setProjectId] = useState(initialProjectId);

  async function change(next: string | null) {
    const prev = projectId;
    setProjectId(next);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setProjectId(prev);
    }
  }

  return (
    <ProjectPicker
      value={projectId}
      projects={projects}
      onChange={change}
      suggested={suggested}
    />
  );
}
