"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Dedicated search box for the /notes list. Debounced into the URL (?q=) so
// the server component re-queries; the input itself is client state, so focus
// and caret survive the re-render. Searches note titles AND bodies (lib/search).
export function NotesSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const skipFirst = useRef(true);

  useEffect(() => {
    // Don't replace the URL on mount — only after the user types.
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    const id = setTimeout(() => {
      const q = value.trim();
      router.replace(q ? `/notes?q=${encodeURIComponent(q)}` : "/notes", {
        scroll: false,
      });
    }, 250);
    return () => clearTimeout(id);
  }, [value, router]);

  return (
    <div className="notes-search">
      <svg
        className="notes-search-icon"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        aria-hidden
      >
        <circle cx="9" cy="9" r="5.5" strokeWidth="1.6" />
        <path d="M13.5 13.5L17 17" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        className="notes-search-input"
        placeholder="Search notes…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setValue("");
        }}
        aria-label="Search notes"
      />
      {value && (
        <button
          type="button"
          className="notes-search-clear"
          onClick={() => setValue("")}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}
