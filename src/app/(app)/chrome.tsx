"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Chrome = {
  sidebarCollapsed: boolean;
  railCollapsed: boolean;
  railWidth: number;
  toggleSidebar: () => void;
  toggleRail: () => void;
  // Live-updates the rail width during a drag; pass persist to save it.
  setRailWidth: (width: number, opts?: { persist?: boolean }) => void;
};

const ChromeContext = createContext<Chrome | null>(null);

export function useChrome(): Chrome {
  const ctx = useContext(ChromeContext);
  if (!ctx) throw new Error("useChrome must be used within ChromeProvider");
  return ctx;
}

const SIDEBAR_KEY = "mh:sidebar-collapsed";
const RAIL_KEY = "mh:rail-collapsed";
const RAIL_WIDTH_KEY = "mh:rail-width";

export const RAIL_WIDTH_DEFAULT = 340;
export const RAIL_WIDTH_MIN = 260;
export const RAIL_WIDTH_MAX = 640;

function clampRailWidth(w: number): number {
  return Math.round(Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, w)));
}

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railWidth, setRailWidthState] = useState(RAIL_WIDTH_DEFAULT);

  // Read persisted state after mount (avoids SSR/hydration mismatch).
  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    setRailCollapsed(localStorage.getItem(RAIL_KEY) === "1");
    const w = Number(localStorage.getItem(RAIL_WIDTH_KEY));
    if (Number.isFinite(w) && w > 0) setRailWidthState(clampRailWidth(w));
  }, []);

  function setRailWidth(width: number, opts?: { persist?: boolean }) {
    const w = clampRailWidth(width);
    setRailWidthState(w);
    if (opts?.persist) {
      try {
        localStorage.setItem(RAIL_WIDTH_KEY, String(w));
      } catch {
        /* ignore */
      }
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function toggleRail() {
    setRailCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <ChromeContext.Provider
      value={{
        sidebarCollapsed,
        railCollapsed,
        railWidth,
        toggleSidebar,
        toggleRail,
        setRailWidth,
      }}
    >
      <div
        className="app-shell"
        data-sidebar={sidebarCollapsed ? "collapsed" : "open"}
        data-rail={railCollapsed ? "collapsed" : "open"}
        style={{ "--rail-width": `${railWidth}px` } as React.CSSProperties}
      >
        {children}
      </div>
    </ChromeContext.Provider>
  );
}

const ChevronIcon = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <path
      d={dir === "left" ? "M12 5l-5 5 5 5" : "M8 5l5 5-5 5"}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function SidebarToggle() {
  const { sidebarCollapsed, toggleSidebar } = useChrome();
  return (
    <button
      type="button"
      className="chrome-toggle sidebar-toggle"
      onClick={toggleSidebar}
      aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      <ChevronIcon dir={sidebarCollapsed ? "right" : "left"} />
    </button>
  );
}

export function RailToggle() {
  const { railCollapsed, toggleRail } = useChrome();
  return (
    <button
      type="button"
      className="chrome-toggle rail-toggle"
      onClick={toggleRail}
      aria-label={railCollapsed ? "Expand action items" : "Collapse action items"}
      title={railCollapsed ? "Expand action items" : "Collapse action items"}
    >
      <ChevronIcon dir={railCollapsed ? "left" : "right"} />
    </button>
  );
}

// Drag strip on the rail's left edge. Dragging left widens the rail; the width
// persists on release. Double-click resets to the default; arrow keys nudge.
export function RailResizeHandle() {
  const { railWidth, setRailWidth } = useChrome();
  const [dragging, setDragging] = useState(false);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    const startX = e.clientX;
    const startWidth = railWidth;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      setRailWidth(startWidth + (startX - ev.clientX));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragging(false);
      setRailWidth(startWidth + (startX - ev.clientX), { persist: true });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // The rail grows leftward, so ArrowLeft widens it.
    if (e.key === "ArrowLeft") setRailWidth(railWidth + 16, { persist: true });
    else if (e.key === "ArrowRight") setRailWidth(railWidth - 16, { persist: true });
    else return;
    e.preventDefault();
  }

  return (
    <div
      className={`rail-resize ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize action rail"
      aria-valuemin={RAIL_WIDTH_MIN}
      aria-valuemax={RAIL_WIDTH_MAX}
      aria-valuenow={railWidth}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setRailWidth(RAIL_WIDTH_DEFAULT, { persist: true })}
      onKeyDown={onKeyDown}
    />
  );
}
