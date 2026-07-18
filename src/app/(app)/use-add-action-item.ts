"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

// Adds selected text as an action item linked to the current context (a meeting or a
// journal entry; both null = standalone), then refreshes so the rail picks it up.
export function useAddActionItem(context: {
  meetingId?: string | null;
  journalEntryId?: string | null;
}) {
  const router = useRouter();
  const meetingId = context.meetingId ?? null;
  const journalEntryId = context.journalEntryId ?? null;
  return useCallback(
    async (text: string) => {
      const content = text.replace(/\s+/g, " ").trim();
      if (!content) return;
      try {
        const res = await fetch("/api/action-items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId, journalEntryId, content }),
        });
        if (res.ok) router.refresh();
      } catch {
        /* ignore */
      }
    },
    [meetingId, journalEntryId, router],
  );
}
