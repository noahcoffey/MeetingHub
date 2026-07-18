"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownEditor } from "./markdown-editor";
import { useSaveReport, type SaveState } from "../../save-status";
import { useAddActionItem } from "../../use-add-action-item";

// Editable generated notes (from the ingest API). Body only — the collapsible header
// is owned by NotesStack. Debounced autosave; reports into the shared save indicator.
export function GeneratedNotesEditor({
  meetingId,
  initial,
}: {
  meetingId: string;
  initial: string;
}) {
  const [status, setStatus] = useState<SaveState>("saved");
  const report = useSaveReport();
  const addActionItem = useAddActionItem({ meetingId });
  const latest = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    report("generated", status);
  }, [status, report]);
  useEffect(() => () => report("generated", "saved"), [report]);

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notesGenerated: latest.current }),
      });
      setStatus(res.ok ? "saved" : "dirty");
    } catch {
      setStatus("dirty");
    }
  }

  function onChange(markdown: string) {
    latest.current = markdown;
    if (!initialized.current) {
      initialized.current = true; // editor's initial content load — not a user edit
      return;
    }
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  }

  return (
    <div className="stack-editor">
      <MarkdownEditor
        initialMarkdown={initial}
        onChange={onChange}
        onAddActionItem={addActionItem}
      />
    </div>
  );
}
