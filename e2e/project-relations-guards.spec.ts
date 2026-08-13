import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./constants";
let otherProjectId = "", relationId = "", ownProjectId = "";
test.beforeAll(async () => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  const [ws] = await sql`select id from workspaces where is_default = true limit 1`;
  await sql`delete from project_relations`; await sql`delete from action_items`;
  await sql`delete from meetings`; await sql`delete from projects`;
  await sql`delete from workspaces where is_default = false`;
  const [other] = await sql`insert into workspaces (name, is_default) values ('Other', false) returning id`;
  const [p1] = await sql`insert into projects (workspace_id, name) values (${ws.id}, 'Mine') returning id`;
  const [p2] = await sql`insert into projects (workspace_id, name) values (${ws.id}, 'Mine two') returning id`;
  const [px] = await sql`insert into projects (workspace_id, name) values (${other.id}, 'Elsewhere') returning id`;
  await sql`insert into action_items (workspace_id, project_id, content, source) values (${other.id}, ${px.id}, 'Secret task', 'manual')`;
  const [rel] = await sql`insert into project_relations (from_id, to_id, kind) values (${p1.id}, ${p2.id}, 'related') returning id`;
  ownProjectId = p1.id; otherProjectId = px.id; relationId = rel.id;
  await sql.end();
});
async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
// The project-scoped session routes all authorize through guardProject. These
// assert the boundary rather than the happy path: a project id from another
// workspace, and edge ids that don't exist.
test("project-scoped routes refuse ids outside the active workspace", async ({
  page,
}) => {
  await login(page);
  await page.goto("/map");
  // Driven from the page so the session cookie rides along.
  const r = await page.evaluate(async ([foreign, own, rel]) => {
    const j = async (url: string, init?: RequestInit) => {
      const res = await fetch(url, init);
      return { status: res.status, body: await res.text() };
    };
    return {
      foreignTasks: await j(`/api/action-items?projectId=${foreign}`),
      ownTasks: await j(`/api/action-items?projectId=${own}`),
      missingProject: await j(`/api/action-items?projectId=00000000-0000-0000-0000-000000000000`),
      badRelationPatch: await j(`/api/project-relations/00000000-0000-0000-0000-000000000000`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "blocks" }) }),
      badRelationDelete: await j(`/api/project-relations/00000000-0000-0000-0000-000000000000`, { method: "DELETE" }),
      missingToId: await j(`/api/project-relations`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromId: own, toId: "00000000-0000-0000-0000-000000000000" }) }),
      realDelete: await j(`/api/project-relations/${rel}`, { method: "DELETE" }),
    };
  }, [otherProjectId, ownProjectId, relationId]);
  expect(r.foreignTasks.status).toBe(404);
  expect(r.foreignTasks.body).not.toContain("Secret task");
  expect(r.ownTasks.status).toBe(200);
  expect(r.badRelationPatch.status).toBe(404);
  expect(r.badRelationDelete.status).toBe(404);
  expect(r.missingToId.status).toBe(404);
  expect(r.realDelete.status).toBe(200);
});
