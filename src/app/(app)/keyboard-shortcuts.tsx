"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// `g` leader → destination.
const NAV: Record<string, string> = {
  d: "/",
  m: "/meetings",
  j: "/journal",
  t: "/tasks",
  r: "/reports",
  s: "/settings",
};

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable)
  );
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [cheatOpen, setCheatOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const leader = useRef(false);
  const leaderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearLeader() {
      leader.current = false;
      if (leaderTimer.current) clearTimeout(leaderTimer.current);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCheatOpen(false);
        setCaptureOpen(false);
        clearLeader();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      // `g` then a destination key.
      if (leader.current) {
        const dest = NAV[e.key.toLowerCase()];
        clearLeader();
        if (dest) {
          e.preventDefault();
          router.push(dest);
        }
        return;
      }

      switch (e.key) {
        case "?":
          e.preventDefault();
          setCheatOpen((o) => !o);
          break;
        case "g":
          leader.current = true;
          leaderTimer.current = setTimeout(() => {
            leader.current = false;
          }, 1200);
          break;
        case "n":
          e.preventDefault();
          if (pathname === "/meetings") {
            window.dispatchEvent(new CustomEvent("mh:new-meeting"));
          } else {
            try {
              sessionStorage.setItem("mh:new-meeting", "1");
            } catch {
              /* ignore */
            }
            router.push("/meetings");
          }
          break;
        case "c":
          e.preventDefault();
          setCaptureOpen(true);
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (leaderTimer.current) clearTimeout(leaderTimer.current);
    };
  }, [pathname, router]);

  return (
    <>
      {captureOpen && (
        <QuickCapture
          onClose={() => setCaptureOpen(false)}
          onAdded={() => router.refresh()}
        />
      )}
      {cheatOpen && <CheatSheet onClose={() => setCheatOpen(false)} />}
    </>
  );
}

function QuickCapture({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(id);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = content.trim();
    if (!c) return;
    setSaving(true);
    try {
      const res = await fetch("/api/action-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: c }),
      });
      if (res.ok) {
        onAdded();
        onClose();
      } else {
        setSaving(false);
      }
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <form
        className="kbd-card"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Quick-add a task…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={saving}
          autoComplete="off"
        />
        <div className="kbd-foot">
          <span>Standalone task</span>
          <span>
            <kbd>↵</kbd> add&nbsp;&nbsp;<kbd>esc</kbd> close
          </span>
        </div>
      </form>
    </div>
  );
}

const CHEAT: [string, string][] = [
  ["Search", "⌘K  /  /"],
  ["New meeting", "n"],
  ["Quick-add task", "c"],
  ["Go to Dashboard", "g d"],
  ["Go to Meetings", "g m"],
  ["Go to Journal", "g j"],
  ["Go to Tasks", "g t"],
  ["Go to Reports", "g r"],
  ["Go to Settings", "g s"],
  ["This cheat sheet", "?"],
];

function CheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div
        className="kbd-card kbd-cheat"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="kbd-cheat-head">Keyboard shortcuts</div>
        <div className="kbd-cheat-list">
          {CHEAT.map(([label, keys]) => (
            <div className="kbd-cheat-row" key={label}>
              <span className="kbd-cheat-label">{label}</span>
              <span className="kbd-cheat-keys">
                {keys.split(" ").map((k, i) => (
                  <kbd key={i}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="kbd-foot">
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
