"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

export type SaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "offline"
  | "conflict"
  | "error";

// Worst-of aggregation so a single indicator can reflect every editor on the page.
function aggregate(states: SaveState[]): SaveState {
  if (states.includes("saving")) return "saving";
  if (states.includes("error")) return "error";
  if (states.includes("conflict")) return "conflict";
  if (states.includes("offline")) return "offline";
  if (states.includes("dirty")) return "dirty";
  return "saved";
}

// Stable reporter (editors subscribe) split from the changing aggregate (indicator
// subscribes) so editors don't re-render on every status change.
const ReportContext = createContext<(key: string, state: SaveState) => void>(
  () => {},
);
const StatusContext = createContext<SaveState>("saved");

export function SaveStatusProvider({ children }: { children: React.ReactNode }) {
  const [map, setMap] = useState<Record<string, SaveState>>({});
  const report = useCallback((key: string, state: SaveState) => {
    setMap((m) => (m[key] === state ? m : { ...m, [key]: state }));
  }, []);
  const status = aggregate(Object.values(map));

  return (
    <ReportContext.Provider value={report}>
      <StatusContext.Provider value={status}>
        {children}
      </StatusContext.Provider>
    </ReportContext.Provider>
  );
}

export function useSaveReport() {
  return useContext(ReportContext);
}

export function SaveIndicator() {
  const status = useContext(StatusContext);
  const map: Record<SaveState, { label: string; tone: string }> = {
    saved: { label: "Saved", tone: "ok" },
    dirty: { label: "Unsaved", tone: "muted" },
    saving: { label: "Saving…", tone: "active" },
    offline: { label: "Offline · kept on this device", tone: "warn" },
    conflict: { label: "Edited elsewhere", tone: "warn" },
    error: { label: "Couldn’t save · retrying", tone: "warn" },
  };
  const { label, tone } = map[status];
  return (
    <div className={`save-status save-${tone}`} aria-live="polite">
      <span className="save-dot" />
      <span className="save-label">{label}</span>
    </div>
  );
}
