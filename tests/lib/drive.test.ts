import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, workspaces } from "@/db/schema";
import { escapeQ } from "@/lib/google-drive";
import {
  assertInTree,
  DRIVE_ACCOUNT_KEY,
  DRIVE_ROOT_FOLDER_KEY,
  DriveScopeError,
  ensureRootFolder,
  managedFolderIds,
} from "@/lib/drive";
import { setStringSetting, getStringSetting } from "@/lib/app-settings";
import { createProject } from "@/lib/projects";
import { makeWorkspace, resetDb } from "../helpers";

// app_settings survives resetDb — clear the drive keys explicitly.
async function clearDriveSettings() {
  await setStringSetting(DRIVE_ACCOUNT_KEY, null);
  await setStringSetting(DRIVE_ROOT_FOLDER_KEY, null);
}

describe("escapeQ", () => {
  it("escapes single quotes and backslashes for Drive q literals", () => {
    expect(escapeQ("plain")).toBe("plain");
    expect(escapeQ("it's")).toBe("it\\'s");
    expect(escapeQ("back\\slash")).toBe("back\\\\slash");
    expect(escapeQ("both\\'")).toBe("both\\\\\\'");
  });
});

describe("managedFolderIds", () => {
  beforeEach(async () => {
    await resetDb();
    await clearDriveSettings();
  });
  afterEach(clearDriveSettings);

  it("collects root + workspace + project folder ids, skipping nulls", async () => {
    await setStringSetting(DRIVE_ROOT_FOLDER_KEY, "root-1");
    const wsId = await makeWorkspace("Alpha", { isDefault: true });
    await db
      .update(workspaces)
      .set({
        driveFolderId: "ws-1",
        driveFilesFolderId: "files-1",
        driveProjectsFolderId: "projects-1",
        // driveArchivedFolderId deliberately unset
      })
      .where(eq(workspaces.id, wsId));
    // Project folder id set directly (lazily created in the real flow).
    const project = await createProject(wsId, { name: "P" });
    await db
      .update(projects)
      .set({ driveFolderId: "proj-1" })
      .where(eq(projects.id, project.id));

    const ids = await managedFolderIds(wsId);
    expect(ids).toEqual(
      new Set(["root-1", "ws-1", "files-1", "projects-1", "proj-1"]),
    );
  });

  it("is empty when nothing is stored", async () => {
    const wsId = await makeWorkspace("Bare", { isDefault: true });
    expect(await managedFolderIds(wsId)).toEqual(new Set());
  });
});

// Minimal fetch stubbing for the Drive REST client. Each entry answers the
// next request in order.
type StubResponse = { status: number; json?: unknown };
function stubFetch(responses: StubResponse[]) {
  const calls: { url: string; method: string }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    return new Response(JSON.stringify(next.json ?? {}), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

describe("ensureRootFolder (self-healing)", () => {
  beforeEach(async () => {
    await resetDb();
    await clearDriveSettings();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearDriveSettings();
  });

  it("keeps a stored id that is alive", async () => {
    await setStringSetting(DRIVE_ROOT_FOLDER_KEY, "root-ok");
    stubFetch([{ status: 200, json: { id: "root-ok", trashed: false } }]);
    expect(await ensureRootFolder("tok")).toBe("root-ok");
    expect(await getStringSetting(DRIVE_ROOT_FOLDER_KEY)).toBe("root-ok");
  });

  it("recreates when the stored id is gone, adopting a found survivor first", async () => {
    await setStringSetting(DRIVE_ROOT_FOLDER_KEY, "root-dead");
    stubFetch([
      { status: 404 }, // files.get on stored id
      { status: 200, json: { files: [{ id: "root-found", name: "MeetingHub" }] } },
    ]);
    expect(await ensureRootFolder("tok")).toBe("root-found");
    expect(await getStringSetting(DRIVE_ROOT_FOLDER_KEY)).toBe("root-found");
  });

  it("creates fresh when nothing is stored and nothing is found", async () => {
    const calls = stubFetch([
      { status: 200, json: { files: [] } }, // find by name
      { status: 200, json: { id: "root-new", name: "MeetingHub" } }, // create
    ]);
    expect(await ensureRootFolder("tok")).toBe("root-new");
    expect(await getStringSetting(DRIVE_ROOT_FOLDER_KEY)).toBe("root-new");
    expect(calls[1].method).toBe("POST");
  });

  it("treats a trashed stored folder as dead", async () => {
    await setStringSetting(DRIVE_ROOT_FOLDER_KEY, "root-trashed");
    stubFetch([
      { status: 200, json: { id: "root-trashed", trashed: true } },
      { status: 200, json: { files: [] } },
      { status: 200, json: { id: "root-new2" } },
    ]);
    expect(await ensureRootFolder("tok")).toBe("root-new2");
  });
});

describe("assertInTree", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the tree root itself without any API call", async () => {
    stubFetch([]);
    await expect(assertInTree("tok", "base", "base")).resolves.toBeUndefined();
  });

  it("accepts a file whose parent chain reaches the base", async () => {
    stubFetch([
      { status: 200, json: { id: "leaf", parents: ["mid"], trashed: false } },
      { status: 200, json: { id: "mid", parents: ["base"], trashed: false } },
    ]);
    await expect(assertInTree("tok", "base", "leaf")).resolves.toBeUndefined();
  });

  it("rejects a file that tops out elsewhere", async () => {
    stubFetch([
      { status: 200, json: { id: "leaf", parents: ["other-root"], trashed: false } },
      { status: 200, json: { id: "other-root", trashed: false } }, // no parents
    ]);
    await expect(assertInTree("tok", "base", "leaf")).rejects.toBeInstanceOf(
      DriveScopeError,
    );
  });

  it("rejects trashed and missing files", async () => {
    stubFetch([
      { status: 200, json: { id: "leaf", parents: ["base"], trashed: true } },
    ]);
    await expect(assertInTree("tok", "base", "leaf")).rejects.toBeInstanceOf(
      DriveScopeError,
    );
    stubFetch([{ status: 404 }]);
    await expect(assertInTree("tok", "base", "gone")).rejects.toBeInstanceOf(
      DriveScopeError,
    );
  });
});
