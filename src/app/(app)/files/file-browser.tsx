"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AddLinkButton, type AddedLink } from "../projects/add-link-button";
import { LinkFavicon } from "../projects/link-favicon";

// Shared Drive file browser: the /files page mounts it bare (workspace Files/
// area) and the project hub Files & Links tab passes projectId (the project's
// folder). Drive is the source of truth for files/folders; project LINKS
// (Postgres rows placed into Drive folders by id) are merged into project
// listings, and when Drive is unavailable the project view degrades to a
// links-only list rather than hiding them.

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

type LinkItem = {
  id: string;
  url: string;
  label: string | null;
  driveFolderId?: string | null;
};

// Non-folder rows interleaved alphabetically so links and files feel like one
// collection; folders keep Drive's folders-first ordering.
type Row = { kind: "file"; file: DriveFile } | { kind: "link"; link: LinkItem };

function mergedRows(files: DriveFile[], links: LinkItem[]): Row[] {
  const folders: Row[] = files
    .filter((f) => f.mimeType === FOLDER_MIME)
    .map((file) => ({ kind: "file", file }));
  const rest: Row[] = [
    ...files
      .filter((f) => f.mimeType !== FOLDER_MIME)
      .map((file): Row => ({ kind: "file", file })),
    ...links.map((link): Row => ({ kind: "link", link })),
  ].sort((a, b) => {
    const an = a.kind === "file" ? a.file.name : a.link.label || a.link.url;
    const bn = b.kind === "file" ? b.file.name : b.link.label || b.link.url;
    return an.toLowerCase().localeCompare(bn.toLowerCase());
  });
  return [...folders, ...rest];
}

type Crumb = { id: string; name: string };

const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_NATIVE_PREFIX = "application/vnd.google-apps.";

type BrowserState =
  | "loading"
  | "ready"
  | "not_configured"
  | "not_connected"
  | "reconnect_required"
  | "error";

function stateFromError(error: string): BrowserState {
  if (
    error === "not_configured" ||
    error === "not_connected" ||
    error === "reconnect_required"
  ) {
    return error;
  }
  return "error";
}

function formatSize(size?: string): string {
  const n = Number(size);
  if (!size || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const stroke = { strokeWidth: 1.5, strokeLinejoin: "round" as const };
  let glyph: React.ReactNode;
  if (mimeType === FOLDER_MIME) {
    glyph = (
      <path
        d="M3.5 6a1 1 0 011-1h4l1.5 1.5H15a1 1 0 011 1V14a1 1 0 01-1 1H4.5a1 1 0 01-1-1V6z"
        {...stroke}
      />
    );
  } else if (mimeType.startsWith("image/")) {
    glyph = (
      <>
        <rect x="3.5" y="4.5" width="13" height="11" rx="1" {...stroke} />
        <circle cx="7.5" cy="8.5" r="1.3" {...stroke} />
        <path d="M4.5 14l3.5-3.5 2.5 2.5 2-2 3 3" {...stroke} />
      </>
    );
  } else if (
    mimeType === "application/pdf" ||
    mimeType.includes("document") ||
    mimeType.includes("word") ||
    mimeType.startsWith("text/")
  ) {
    glyph = (
      <>
        <path d="M5.5 3.5h6L15 7v9a.9.9 0 01-.9.9H5.5a.9.9 0 01-.9-.9v-11a.9.9 0 01.9-.9z" {...stroke} />
        <path d="M11.5 3.5V7H15" {...stroke} />
        <path d="M7.5 10.5h5M7.5 13h5" strokeWidth="1.3" strokeLinecap="round" />
      </>
    );
  } else if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType === "text/csv"
  ) {
    glyph = (
      <>
        <rect x="4" y="4" width="12" height="12" rx="1" {...stroke} />
        <path d="M4 8.5h12M4 12.5h12M9.5 4v12" strokeWidth="1.3" />
      </>
    );
  } else if (mimeType.includes("presentation")) {
    glyph = (
      <>
        <rect x="3.5" y="4.5" width="13" height="9" rx="1" {...stroke} />
        <path d="M10 13.5v2.5M7 16.5h6" strokeWidth="1.4" strokeLinecap="round" />
      </>
    );
  } else if (
    mimeType.includes("zip") ||
    mimeType.includes("compressed") ||
    mimeType.includes("tar")
  ) {
    glyph = (
      <>
        <path d="M5.5 3.5h6L15 7v9a.9.9 0 01-.9.9H5.5a.9.9 0 01-.9-.9v-11a.9.9 0 01.9-.9z" {...stroke} />
        <path d="M8 4v1.2M8 6.5v1.2M8 9v1.2" strokeWidth="1.4" strokeLinecap="round" />
      </>
    );
  } else {
    glyph = (
      <>
        <path d="M5.5 3.5h6L15 7v9a.9.9 0 01-.9.9H5.5a.9.9 0 01-.9-.9v-11a.9.9 0 01.9-.9z" {...stroke} />
        <path d="M11.5 3.5V7H15" {...stroke} />
      </>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      {glyph}
    </svg>
  );
}

export function FileBrowser({ projectId }: { projectId?: string }) {
  const [state, setState] = useState<BrowserState>("loading");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  // "ok" or why Drive is unavailable (project mode then shows links only).
  const [driveKey, setDriveKey] = useState<string>("ok");
  const [crumbs, setCrumbs] = useState<Crumb[]>([]); // path below the base
  const [actionError, setActionError] = useState<string | null>(null);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentFolderId = crumbs.length ? crumbs[crumbs.length - 1].id : null;

  const query = useCallback(
    (folderId: string | null) => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (folderId) params.set("folderId", folderId);
      const qs = params.toString();
      return qs ? `?${qs}` : "";
    },
    [projectId],
  );

  const load = useCallback(
    async (folderId: string | null) => {
      setState("loading");
      setActionError(null);
      try {
        const res = await fetch(`/api/drive/files${query(folderId)}`);
        const data = await res.json();
        if (!res.ok) {
          setState(stateFromError(data.error ?? ""));
          return;
        }
        setFiles(data.files);
        setLinks(data.links ?? []);
        setDriveKey(data.drive ?? "ok");
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [query],
  );

  useEffect(() => {
    void load(null);
    // Reset the path when the target tree changes.
    setCrumbs([]);
  }, [load]);

  function enterFolder(f: DriveFile) {
    setCrumbs((c) => [...c, { id: f.id, name: f.name }]);
    void load(f.id);
  }

  function jumpTo(index: number) {
    // index -1 = base
    const next = index < 0 ? [] : crumbs.slice(0, index + 1);
    setCrumbs(next);
    void load(next.length ? next[next.length - 1].id : null);
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    setSavingFolder(true);
    setActionError(null);
    try {
      const res = await fetch("/api/drive/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          parentId: currentFolderId,
          projectId: projectId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create folder");
      setFiles((prev) =>
        [...prev, data.folder as DriveFile].sort((a, b) => {
          const af = a.mimeType === FOLDER_MIME ? 0 : 1;
          const bf = b.mimeType === FOLDER_MIME ? 0 : 1;
          return af - bf || a.name.localeCompare(b.name);
        }),
      );
      setNewFolderName("");
      setCreatingFolder(false);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not create folder",
      );
    } finally {
      setSavingFolder(false);
    }
  }

  async function uploadFiles(list: FileList) {
    const items = Array.from(list);
    setActionError(null);
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      setUploadNote(
        items.length > 1
          ? `Uploading ${i + 1} of ${items.length}: ${f.name}`
          : `Uploading ${f.name}…`,
      );
      try {
        const form = new FormData();
        form.set("file", f);
        if (currentFolderId) form.set("parentId", currentFolderId);
        if (projectId) form.set("projectId", projectId);
        const res = await fetch("/api/drive/files", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        setFiles((prev) => [...prev, data.file as DriveFile]);
      } catch (err) {
        setActionError(
          err instanceof Error
            ? `${f.name}: ${err.message}`
            : `${f.name}: upload failed`,
        );
        break;
      }
    }
    setUploadNote(null);
  }

  async function rename(id: string) {
    const name = renameValue.trim();
    const target = files.find((f) => f.id === id);
    if (!name || !target || name === target.name) {
      setRenamingId(null);
      return;
    }
    const prev = files;
    setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)));
    setRenamingId(null);
    try {
      const res = await fetch(`/api/drive/files/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, projectId: projectId ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Rename failed");
    } catch (err) {
      setFiles(prev);
      setActionError(err instanceof Error ? err.message : "Rename failed");
    }
  }

  async function remove(id: string) {
    setConfirmDeleteId(null);
    const prev = files;
    setFiles((fs) => fs.filter((f) => f.id !== id));
    try {
      const params = projectId ? `?projectId=${projectId}` : "";
      const res = await fetch(`/api/drive/files/${id}${params}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Delete failed");
      }
    } catch (err) {
      setFiles(prev);
      setActionError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function linkAdded(link: AddedLink) {
    setLinks((prev) => [...prev, link]);
  }

  async function removeLink(id: string) {
    const prev = links;
    setLinks((ls) => ls.filter((l) => l.id !== id));
    try {
      const res = await fetch(`/api/project-links/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setLinks(prev);
      setActionError("Could not remove link");
    }
  }

  const linkRow = (l: LinkItem) => (
    <li key={`link-${l.id}`} className="file-row">
      <span className="file-icon">
        <LinkFavicon url={l.url} />
      </span>
      <a
        className="file-name"
        href={l.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {l.label || l.url}
      </a>
      <span className="file-meta">
        <span className="file-date">Link</span>
      </span>
      <span className="file-actions">
        <button
          type="button"
          className="row-action danger"
          onClick={() => void removeLink(l.id)}
        >
          Remove
        </button>
      </span>
    </li>
  );

  if (state === "not_configured") {
    return (
      <p className="muted empty-sm">
        Google isn&apos;t configured on this server. Set{" "}
        <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to
        enable Drive files.
      </p>
    );
  }
  if (state === "not_connected") {
    return (
      <div className="file-browser-cta">
        <p className="muted">
          Connect your Google Drive to store files here — the app keeps
          everything in a <code>MeetingHub</code> folder it creates for you.
        </p>
        <a className="primary-btn" href="/settings/drive">
          Set up Drive
        </a>
      </div>
    );
  }
  if (state === "reconnect_required") {
    return (
      <div className="file-browser-cta">
        <p className="settings-banner err">
          Google Drive access was revoked or expired — reconnect to continue.
        </p>
        <a className="primary-btn" href="/settings/drive">
          Reconnect Drive
        </a>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="file-browser-cta">
        <p className="settings-banner err">
          Could not reach Google Drive. Try again in a moment.
        </p>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => void load(currentFolderId)}
        >
          Retry
        </button>
      </div>
    );
  }

  // Project mode with Drive unavailable: links still work (flat list, new
  // ones land at the project's top level); files need Drive.
  if (state === "ready" && driveKey !== "ok" && projectId) {
    const note =
      driveKey === "reconnect_required"
        ? "Google Drive access expired — reconnect to see this project's files."
        : driveKey === "not_configured"
          ? "Files need Google Drive, which isn't configured on this server. Links work without it."
          : "Connect Google Drive to add files and folders here. Links work without it.";
    return (
      <div className="file-browser">
        <div className="file-toolbar">
          <p className="muted file-degraded-note">{note}</p>
          <div className="file-toolbar-actions">
            {driveKey !== "not_configured" && (
              <a className="ghost-btn" href="/settings/drive">
                {driveKey === "reconnect_required"
                  ? "Reconnect Drive"
                  : "Set up Drive"}
              </a>
            )}
            <AddLinkButton projectId={projectId} onAdded={linkAdded} />
          </div>
        </div>
        {actionError && <p className="settings-banner err">{actionError}</p>}
        {links.length === 0 ? (
          <p className="muted empty-sm">No links yet.</p>
        ) : (
          <ul className="file-list">{links.map(linkRow)}</ul>
        )}
      </div>
    );
  }

  const rows = mergedRows(files, projectId ? links : []);

  return (
    <div className="file-browser">
      <div className="file-toolbar">
        <nav className="file-crumbs" aria-label="Folder path">
          <button
            type="button"
            className={`file-crumb ${crumbs.length === 0 ? "is-current" : ""}`}
            onClick={() => jumpTo(-1)}
            disabled={crumbs.length === 0}
          >
            {projectId ? "Project files" : "Files"}
          </button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="file-crumb-seg">
              <span className="file-crumb-sep" aria-hidden>
                /
              </span>
              <button
                type="button"
                className={`file-crumb ${i === crumbs.length - 1 ? "is-current" : ""}`}
                onClick={() => jumpTo(i)}
                disabled={i === crumbs.length - 1}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="file-toolbar-actions">
          {projectId && (
            <AddLinkButton
              projectId={projectId}
              driveFolderId={currentFolderId}
              onAdded={linkAdded}
            />
          )}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setCreatingFolder(true)}
            disabled={state === "loading" || creatingFolder}
          >
            New folder
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={state === "loading" || uploadNote !== null}
          >
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {uploadNote && <p className="file-upload-note">{uploadNote}</p>}
      {actionError && <p className="settings-banner err">{actionError}</p>}

      {creatingFolder && (
        <form className="file-newfolder-form" onSubmit={createFolder}>
          <input
            type="text"
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            autoFocus
            required
          />
          <button
            type="submit"
            className="primary-btn"
            disabled={savingFolder || !newFolderName.trim()}
          >
            {savingFolder ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setCreatingFolder(false);
              setNewFolderName("");
            }}
            disabled={savingFolder}
          >
            Cancel
          </button>
        </form>
      )}

      {state === "loading" ? (
        <p className="muted empty-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted empty-sm">
          {projectId
            ? "Nothing here yet — upload a file, create a folder, or add a link."
            : "Nothing here yet — upload a file or create a folder."}
        </p>
      ) : (
        <ul className="file-list">
          {rows.map((row) => {
            if (row.kind === "link") return linkRow(row.link);
            const f = row.file;
            const isFolder = f.mimeType === FOLDER_MIME;
            const isGoogleNative =
              !isFolder && f.mimeType.startsWith(GOOGLE_NATIVE_PREFIX);
            const downloadHref = `/api/drive/files/${f.id}/download${
              projectId ? `?projectId=${projectId}` : ""
            }`;
            return (
              <li key={f.id} className="file-row">
                <span className={`file-icon ${isFolder ? "is-folder" : ""}`}>
                  <FileIcon mimeType={f.mimeType} />
                </span>
                {renamingId === f.id ? (
                  <form
                    className="file-rename-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename(f.id);
                    }}
                  >
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                      onBlur={() => setRenamingId(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  </form>
                ) : isFolder ? (
                  <button
                    type="button"
                    className="file-name file-name-folder"
                    onClick={() => enterFolder(f)}
                  >
                    {f.name}
                  </button>
                ) : (
                  <span className="file-name">{f.name}</span>
                )}
                <span className="file-meta">
                  {!isFolder && (
                    <span className="file-size">{formatSize(f.size)}</span>
                  )}
                  <span className="file-date">{formatDate(f.modifiedTime)}</span>
                </span>
                <span className="file-actions">
                  {confirmDeleteId === f.id ? (
                    <>
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() => void remove(f.id)}
                      >
                        {isFolder ? "Trash folder" : "Trash"}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {f.webViewLink && (
                        <a
                          className="row-action"
                          href={f.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open in Drive
                        </a>
                      )}
                      {!isFolder && !isGoogleNative && (
                        <a className="row-action" href={downloadHref}>
                          Download
                        </a>
                      )}
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => {
                          setRenamingId(f.id);
                          setRenameValue(f.name);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="row-action danger"
                        onClick={() => setConfirmDeleteId(f.id)}
                      >
                        Trash
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
