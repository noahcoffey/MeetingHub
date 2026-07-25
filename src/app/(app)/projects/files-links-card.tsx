"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AddLinkButton, type AddedLink } from "./add-link-button";
import { LinkFavicon } from "./link-favicon";

// Overview-card variant of the unified Files & Links view: read-mostly,
// folders expand inline (fetched per folder on first open) instead of
// navigating. Renders the server-passed links immediately, then swaps in the
// full merged base listing from /api/drive/files. Management (upload, rename,
// trash, remove) lives in the Files & Links tab; here the only action is
// adding a link at the project's top level.

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
};

type LinkItem = { id: string; url: string; label: string | null };

const FOLDER_MIME = "application/vnd.google-apps.folder";

type Listing = { files: DriveFile[]; links: LinkItem[] };

function sortedEntries(l: Listing): (
  | { kind: "folder"; file: DriveFile }
  | { kind: "file"; file: DriveFile }
  | { kind: "link"; link: LinkItem }
)[] {
  const folders = l.files
    .filter((f) => f.mimeType === FOLDER_MIME)
    .map((file) => ({ kind: "folder" as const, file }));
  const rest = [
    ...l.files
      .filter((f) => f.mimeType !== FOLDER_MIME)
      .map((file) => ({ kind: "file" as const, file })),
    ...l.links.map((link) => ({ kind: "link" as const, link })),
  ].sort((a, b) => {
    const an = a.kind === "file" ? a.file.name : a.link.label || a.link.url;
    const bn = b.kind === "file" ? b.file.name : b.link.label || b.link.url;
    return an.toLowerCase().localeCompare(bn.toLowerCase());
  });
  return [...folders, ...rest];
}

export function FilesLinksCard({
  projectId,
  initialLinks,
}: {
  projectId: string;
  initialLinks: LinkItem[];
}) {
  // Base listing; starts as the server-rendered links so the card is never
  // blank while Drive loads.
  const [base, setBase] = useState<Listing>({ files: [], links: initialLinks });
  const [driveOk, setDriveOk] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // folderId -> its fetched listing (undefined = not fetched yet).
  const [children, setChildren] = useState<Record<string, Listing>>({});
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  const fetchListing = useCallback(
    async (folderId: string | null): Promise<Listing & { drive?: string } | null> => {
      try {
        const params = new URLSearchParams({ projectId });
        if (folderId) params.set("folderId", folderId);
        const res = await fetch(`/api/drive/files?${params.toString()}`);
        if (!res.ok) return null;
        const data = await res.json();
        return {
          files: data.files ?? [],
          links: data.links ?? [],
          drive: data.drive,
        };
      } catch {
        return null;
      }
    },
    [projectId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listing = await fetchListing(null);
      if (cancelled) return;
      if (listing) {
        setBase({ files: listing.files, links: listing.links });
        setDriveOk(listing.drive === "ok");
      }
      // Loaded even on failure so the empty state can't stick on "Loading…".
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchListing]);

  function toggleFolder(id: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (children[id] === undefined) {
      void (async () => {
        const listing = await fetchListing(id);
        setChildren((prev) => ({
          ...prev,
          [id]: listing ?? { files: [], links: [] },
        }));
      })();
    }
  }

  function linkAdded(link: AddedLink) {
    setBase((prev) => ({ ...prev, links: [...prev.links, link] }));
  }

  function renderListing(listing: Listing, depth: number): ReactNode {
    return sortedEntries(listing).map((entry) => {
      if (entry.kind === "folder") {
        const open = openFolders.has(entry.file.id);
        const kids = children[entry.file.id];
        return (
          <li key={entry.file.id} className="flc-item">
            <button
              type="button"
              className="flc-row flc-folder"
              onClick={() => toggleFolder(entry.file.id)}
              aria-expanded={open}
            >
              <span className={`flc-chevron ${open ? "open" : ""}`} aria-hidden>
                ›
              </span>
              <span className="flc-name">{entry.file.name}</span>
            </button>
            {open && (
              <ul className="flc-list flc-nested">
                {kids === undefined ? (
                  <li className="flc-item muted flc-loading">Loading…</li>
                ) : kids.files.length === 0 && kids.links.length === 0 ? (
                  <li className="flc-item muted flc-loading">Empty</li>
                ) : (
                  renderListing(kids, depth + 1)
                )}
              </ul>
            )}
          </li>
        );
      }
      if (entry.kind === "file") {
        return (
          <li key={entry.file.id} className="flc-item">
            <a
              className="flc-row"
              href={entry.file.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="flc-icon" aria-hidden>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">
                  <path
                    d="M5.5 3.5h6L15 7v9a.9.9 0 01-.9.9H5.5a.9.9 0 01-.9-.9v-11a.9.9 0 01.9-.9z"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path d="M11.5 3.5V7H15" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="flc-name">{entry.file.name}</span>
            </a>
          </li>
        );
      }
      return (
        <li key={`link-${entry.link.id}`} className="flc-item">
          <a
            className="flc-row"
            href={entry.link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="flc-icon">
              <LinkFavicon url={entry.link.url} />
            </span>
            <span className="flc-name">{entry.link.label || entry.link.url}</span>
          </a>
        </li>
      );
    });
  }

  const count = base.files.length + base.links.length;

  return (
    <>
      <div className="hub-card-head">
        <h2>Files &amp; Links</h2>
        {count > 0 && <span className="count">{count}</span>}
        <AddLinkButton projectId={projectId} onAdded={linkAdded} />
      </div>
      {count === 0 ? (
        <p className="muted empty-sm">
          {!loaded
            ? "Loading…"
            : driveOk
              ? "No files or links yet."
              : "No links yet. Files appear here once Drive is connected."}
        </p>
      ) : (
        <ul className="flc-list">{renderListing(base, 0)}</ul>
      )}
    </>
  );
}
