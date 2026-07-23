import "server-only";
import { timedFetch } from "./google-auth";

// Thin Google Drive v3 REST client. No business logic here — folder hierarchy,
// protection rules, and token/designation handling live in lib/drive.ts.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
// Uploading the whole buffer in one PUT can legitimately outlive the default
// 15s API timeout on a slow uplink.
const UPLOAD_TIMEOUT_MS = 120_000;

export const FOLDER_MIME = "application/vnd.google-apps.folder";

// Fields returned for browser rows. `size` is absent on folders/Google Docs.
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

export class DriveApiError extends Error {
  status: number;
  constructor(op: string, status: number) {
    // Message stays terse and content-free (no file names/ids).
    super(`google drive ${op} failed (${status})`);
    this.name = "DriveApiError";
    this.status = status;
  }
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// Escape a value for embedding in a Drive `q` query string literal.
export function escapeQ(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function listChildren(
  token: string,
  folderId: string,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${escapeQ(folderId)}' in parents and trashed=false`,
      fields: `files(${FILE_FIELDS}),nextPageToken`,
      orderBy: "folder,name",
      pageSize: "200",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await timedFetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: authHeader(token),
    });
    if (!res.ok) throw new DriveApiError("files.list", res.status);
    const json = (await res.json()) as {
      files?: DriveFile[];
      nextPageToken?: string;
    };
    out.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

// First non-trashed child folder with this exact name, or null.
export async function findChildFolder(
  token: string,
  parentId: string,
  name: string,
): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    q: `name='${escapeQ(name)}' and '${escapeQ(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: `files(${FILE_FIELDS})`,
    pageSize: "1",
  });
  const res = await timedFetch(`${DRIVE_API}/files?${params.toString()}`, {
    headers: authHeader(token),
  });
  if (!res.ok) throw new DriveApiError("files.list", res.status);
  const json = (await res.json()) as { files?: DriveFile[] };
  return json.files?.[0] ?? null;
}

export async function createFolder(
  token: string,
  parentId: string,
  name: string,
): Promise<DriveFile> {
  const res = await timedFetch(`${DRIVE_API}/files?fields=${FILE_FIELDS}`, {
    method: "POST",
    headers: { ...authHeader(token), "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) throw new DriveApiError("files.create", res.status);
  return (await res.json()) as DriveFile;
}

// Resumable upload done in one shot: open the session, then PUT the whole
// buffer. Uniform for all sizes and avoids multipart body assembly.
export async function uploadFile(
  token: string,
  parentId: string,
  name: string,
  mimeType: string,
  data: Uint8Array,
): Promise<DriveFile> {
  const open = await timedFetch(
    `${UPLOAD_API}/files?uploadType=resumable&fields=${FILE_FIELDS}`,
    {
      method: "POST",
      headers: {
        ...authHeader(token),
        "content-type": "application/json",
        "x-upload-content-type": mimeType,
        "x-upload-content-length": String(data.byteLength),
      },
      body: JSON.stringify({ name, parents: [parentId] }),
    },
  );
  if (!open.ok) throw new DriveApiError("upload.open", open.status);
  const session = open.headers.get("location");
  if (!session) throw new DriveApiError("upload.open", 502);

  const put = await timedFetch(
    session,
    {
      method: "PUT",
      headers: { "content-type": mimeType },
      body: data as BodyInit,
    },
    UPLOAD_TIMEOUT_MS,
  );
  if (!put.ok) throw new DriveApiError("upload.put", put.status);
  return (await put.json()) as DriveFile;
}

export async function getFileMeta(
  token: string,
  fileId: string,
  fields = "id,name,mimeType,parents,trashed",
): Promise<{
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
}> {
  const params = new URLSearchParams({ fields });
  const res = await timedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers: authHeader(token) },
  );
  if (!res.ok) throw new DriveApiError("files.get", res.status);
  return (await res.json()) as {
    id: string;
    name?: string;
    mimeType?: string;
    parents?: string[];
    trashed?: boolean;
  };
}

export async function renameFile(
  token: string,
  fileId: string,
  name: string,
): Promise<DriveFile> {
  const res = await timedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`,
    {
      method: "PATCH",
      headers: { ...authHeader(token), "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) throw new DriveApiError("files.rename", res.status);
  return (await res.json()) as DriveFile;
}

export async function trashFile(token: string, fileId: string): Promise<void> {
  const res = await timedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    {
      method: "PATCH",
      headers: { ...authHeader(token), "content-type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    },
  );
  if (!res.ok) throw new DriveApiError("files.trash", res.status);
}

// Re-parent a file, removing whatever parents it currently has.
export async function moveFile(
  token: string,
  fileId: string,
  toParentId: string,
): Promise<void> {
  const meta = await getFileMeta(token, fileId, "id,parents");
  const params = new URLSearchParams({ addParents: toParentId });
  if (meta.parents?.length) {
    params.set("removeParents", meta.parents.join(","));
  }
  const res = await timedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    {
      method: "PATCH",
      headers: { ...authHeader(token), "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) throw new DriveApiError("files.move", res.status);
}

// Raw content response — the route streams `res.body` through to the browser.
// timedFetch only bounds time-to-headers; the body stream itself is unbounded.
export async function downloadFile(
  token: string,
  fileId: string,
): Promise<Response> {
  const res = await timedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: authHeader(token) },
  );
  if (!res.ok) throw new DriveApiError("files.download", res.status);
  return res;
}
