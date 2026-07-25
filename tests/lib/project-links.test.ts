import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLink,
  linkFolderIdsForProject,
  listLinksForProject,
  listLinksInFolder,
  rehomeLinksFromFolders,
} from "@/lib/project-links";
import { collectFolderTreeIds, healLinkFolders } from "@/lib/drive";
import { createProject } from "@/lib/projects";
import { makeWorkspace, resetDb } from "../helpers";

let projectId: string;

beforeEach(async () => {
  await resetDb();
  const ws = await makeWorkspace("Alpha", { isDefault: true });
  projectId = (await createProject(ws, { name: "P" })).id;
});

describe("link folder placement", () => {
  it("separates base-level (null) links from folder links", async () => {
    await createLink({ projectId, url: "https://a.example" });
    await createLink({
      projectId,
      url: "https://b.example",
      driveFolderId: "folder-1",
    });

    const base = await listLinksInFolder(projectId, null);
    const inFolder = await listLinksInFolder(projectId, "folder-1");
    expect(base.map((l) => l.url)).toEqual(["https://a.example"]);
    expect(inFolder.map((l) => l.url)).toEqual(["https://b.example"]);
    expect(await linkFolderIdsForProject(projectId)).toEqual(["folder-1"]);
  });

  it("rehomes links from dead folders to the base level", async () => {
    await createLink({
      projectId,
      url: "https://x.example",
      driveFolderId: "dead-1",
    });
    await createLink({
      projectId,
      url: "https://y.example",
      driveFolderId: "alive-1",
    });

    await rehomeLinksFromFolders(["dead-1"]);
    const base = await listLinksInFolder(projectId, null);
    expect(base.map((l) => l.url)).toEqual(["https://x.example"]);
    expect(
      (await listLinksInFolder(projectId, "alive-1")).map((l) => l.url),
    ).toEqual(["https://y.example"]);
  });

  it("rehome with no ids is a no-op", async () => {
    await createLink({
      projectId,
      url: "https://z.example",
      driveFolderId: "f",
    });
    await rehomeLinksFromFolders([]);
    expect(await listLinksInFolder(projectId, "f")).toHaveLength(1);
  });
});

// fetch stub answering requests in order (same style as drive.test.ts).
type StubResponse = { status: number; json?: unknown };
function stubFetch(responses: StubResponse[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch");
      return new Response(JSON.stringify(next.json ?? {}), {
        status: next.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

describe("healLinkFolders", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("nulls placements whose folder is gone or trashed, keeps live ones", async () => {
    await createLink({
      projectId,
      url: "https://gone.example",
      driveFolderId: "gone",
    });
    await createLink({
      projectId,
      url: "https://trashed.example",
      driveFolderId: "trashed",
    });
    await createLink({
      projectId,
      url: "https://live.example",
      driveFolderId: "live",
    });

    // One files.get per distinct folder id; selectDistinct order isn't
    // guaranteed, so answer by id via a lookup instead of order.
    const byId: Record<string, StubResponse> = {
      gone: { status: 404 },
      trashed: { status: 200, json: { id: "trashed", trashed: true } },
      live: { status: 200, json: { id: "live", trashed: false } },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const id = Object.keys(byId).find((k) =>
          url.includes(`/files/${k}?`),
        );
        const r = id ? byId[id] : { status: 500 };
        return new Response(JSON.stringify(r.json ?? {}), {
          status: r.status,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await healLinkFolders("tok", projectId);

    const base = await listLinksForProject(projectId).then((ls) =>
      ls.filter((l) => l.driveFolderId === null).map((l) => l.url),
    );
    expect(base.sort()).toEqual([
      "https://gone.example",
      "https://trashed.example",
    ]);
    expect(
      (await listLinksInFolder(projectId, "live")).map((l) => l.url),
    ).toEqual(["https://live.example"]);
  });
});

describe("collectFolderTreeIds", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("collects the root and all descendant folder ids breadth-first", async () => {
    // root -> [a, b]; a -> [c]; b -> []; c -> []
    stubFetch([
      { status: 200, json: { files: [{ id: "a" }, { id: "b" }] } },
      { status: 200, json: { files: [{ id: "c" }] } },
      { status: 200, json: { files: [] } },
      { status: 200, json: { files: [] } },
    ]);
    const ids = await collectFolderTreeIds("tok", "root");
    expect(ids.sort()).toEqual(["a", "b", "c", "root"]);
  });
});
