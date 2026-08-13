import { beforeEach, describe, expect, it } from "vitest";
import {
  createProject,
  getProjectSummaries,
  listProjects,
  updateProject,
} from "@/lib/projects";
import { search } from "@/lib/search";
import { makeWorkspace, resetDb } from "../helpers";

let ws: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
});

// A parked project is an idea captured mid-meeting, not a real initiative. The
// whole design rests on it staying out of every active-project surface — one
// leak and quick capture starts polluting the project list instead of
// protecting it.
describe("parked projects stay out of active surfaces", () => {
  beforeEach(async () => {
    await createProject(ws, { name: "Real initiative" });
    await createProject(ws, { name: "Parked idea", status: "parked" });
    await createProject(ws, { name: "Old thing", status: "archived" });
  });

  it("are absent from a bare listProjects", async () => {
    const names = (await listProjects(ws)).map((p) => p.name);
    expect(names).toEqual(["Real initiative"]);
  });

  it("are absent from includeArchived (which is not 'include everything')", async () => {
    const names = (await listProjects(ws, { includeArchived: true }))
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(["Old thing", "Real initiative"]);
  });

  it("appear only under includeParked", async () => {
    const names = (await listProjects(ws, { includeParked: true }))
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(["Parked idea", "Real initiative"]);
  });

  it("are absent from the /projects summaries", async () => {
    const names = (await getProjectSummaries(ws)).map((p) => p.name);
    expect(names).toEqual(["Real initiative"]);
  });
});

describe("promoting a parked project", () => {
  it("makes it a normal active project", async () => {
    const p = await createProject(ws, { name: "Idea", status: "parked" });
    await updateProject(p.id, { status: "active" });
    expect((await listProjects(ws)).map((x) => x.name)).toEqual(["Idea"]);
  });
});

describe("search", () => {
  it("finds parked projects but flags them", async () => {
    await createProject(ws, { name: "Payments rework", status: "parked" });
    await createProject(ws, { name: "Payments platform" });
    const results = await search(ws, "payments");
    const parked = results.projects.find((p) => p.name === "Payments rework");
    const active = results.projects.find((p) => p.name === "Payments platform");
    expect(parked?.parked).toBe(true);
    expect(active?.parked).toBe(false);
  });

  it("does not surface archived projects", async () => {
    await createProject(ws, { name: "Retired thing", status: "archived" });
    const results = await search(ws, "retired");
    expect(results.projects).toHaveLength(0);
  });
});
