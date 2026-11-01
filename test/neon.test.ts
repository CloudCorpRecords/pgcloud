import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  completeDatabaseMigration,
  createBranch,
  createProject,
  describeBranch,
  describeTableSchema,
  explainSqlStatement,
  getConnectionString,
  getDatabaseTables,
  listProjects,
  listSlowQueries,
  prepareDatabaseMigration,
  requireApiKey,
  runSql,
  runSqlTransaction,
} from "../src/neon.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

// Hand-written fixtures in the documented shapes of the Neon API v2
// responses and the HTTP SQL endpoint's result payloads.
const URI =
  "postgresql://alex:secret@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require";

function jsonResponse(body: unknown, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

interface Call {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

function fakeFetch(calls: Call[]): FetchFn {
  return async (url: string, init) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers: init?.headers, body: init?.body });
    if (url.endsWith("/sql")) {
      const body = JSON.parse(init?.body ?? "{}") as { queries?: unknown[] };
      if (Array.isArray(body.queries)) {
        return jsonResponse(body.queries.map(() => ({ rows: [], fields: [] })));
      }
      return jsonResponse({ rows: [{ value: 1 }], fields: [{ name: "value" }] });
    }
    if (url.includes("/connection_uri")) return jsonResponse({ uri: URI });
    if (url.includes("/branches/") && url.endsWith("/databases")) {
      return jsonResponse({ databases: [{ name: "neondb", owner_name: "alex" }] });
    }
    if (method === "POST" && url.endsWith("/branches")) {
      return jsonResponse({ branch: { id: "br-temp-1" }, endpoints: [] });
    }
    if (method === "DELETE" && url.includes("/branches/")) {
      return jsonResponse({ branch: { id: "br-temp-1" } });
    }
    if (url.includes("/branches/")) return jsonResponse({ branch: { id: "br-main" } });
    if (url.includes("/endpoints")) {
      return jsonResponse({ endpoints: [{ id: "ep-1", type: "read_write" }] });
    }
    if (url.includes("/organizations")) {
      return jsonResponse({ organizations: [{ id: "org-1", name: "Acme" }] });
    }
    if (method === "POST" && url.endsWith("/projects")) {
      return jsonResponse({ project: { id: "proj-new", name: "demo" } });
    }
    if (method === "GET" && url.includes("/projects/")) {
      return jsonResponse({ project: { id: "proj-1", name: "demo" } });
    }
    if (url.includes("/projects")) {
      return jsonResponse({ projects: [{ id: "proj-1", name: "demo" }] });
    }
    return jsonResponse({ message: "not found" }, 404, "Not Found");
  };
}

describe("requireApiKey", () => {
  it("rejects a missing or blank key with an error naming NEON_API_KEY", () => {
    assert.throws(() => requireApiKey(undefined), /NEON_API_KEY/);
    assert.throws(() => requireApiKey("   "), /NEON_API_KEY/);
    assert.equal(requireApiKey(" key "), "key");
  });
});

describe("listProjects", () => {
  it("GETs /projects with limit/search and the Bearer header", async () => {
    const calls: Call[] = [];
    const out = (await listProjects(fakeFetch(calls), "test-key", {
      limit: 5,
      search: "demo",
    })) as { projects: unknown[] };
    assert.equal(out.projects.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/api/v2/projects");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.get("search"), "demo");
    assert.equal(calls[0].headers?.Authorization, "Bearer test-key");
  });

  it("fails before any request when the key is missing", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(() => listProjects(spy, undefined, {}), /NEON_API_KEY/);
    assert.equal(called, false);
  });
});

describe("createProject / createBranch body shaping", () => {
  it("wraps project fields in a project object, skipping unset fields", async () => {
    const calls: Call[] = [];
    await createProject(fakeFetch(calls), "k", { name: "demo", region_id: "aws-us-east-2" });
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      project: { name: "demo", region_id: "aws-us-east-2" },
    });
  });

  it("sends branch name/parent plus a read_write endpoint", async () => {
    const calls: Call[] = [];
    await createBranch(fakeFetch(calls), "k", {
      projectId: "proj-1",
      branchName: "dev",
      parentBranchId: "br-main",
    });
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/api/v2/projects/proj-1/branches");
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      branch: { name: "dev", parent_id: "br-main" },
      endpoints: [{ type: "read_write" }],
    });
  });
});

describe("describeBranch", () => {
  it("combines the branch record with its databases", async () => {
    const calls: Call[] = [];
    const out = (await describeBranch(fakeFetch(calls), "k", {
      projectId: "proj-1",
      branchId: "br-main",
    })) as { branch: unknown; databases: { databases: unknown[] } };
    assert.equal(out.databases.databases.length, 1);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].url.endsWith("/branches/br-main/databases"));
  });
});

describe("getConnectionString", () => {
  it("passes database/role/pooled/branch as query params and returns the uri", async () => {
    const calls: Call[] = [];
    const out = await getConnectionString(fakeFetch(calls), "k", {
      projectId: "proj-1",
      branchId: "br-main",
      databaseName: "neondb",
      roleName: "alex",
      pooled: true,
    });
    assert.equal(out, URI);
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get("branch_id"), "br-main");
    assert.equal(url.searchParams.get("database"), "neondb");
    assert.equal(url.searchParams.get("role"), "alex");
    assert.equal(url.searchParams.get("pooled"), "true");
  });
});

describe("runSql", () => {
  it("resolves the connection URI, then POSTs the statement to the host /sql endpoint", async () => {
    const calls: Call[] = [];
    const out = (await runSql(fakeFetch(calls), "k", {
      projectId: "proj-1",
      sql: "select 1 as value",
    })) as { rows: unknown[] };
    assert.equal(out.rows.length, 1);
    assert.equal(calls.length, 2);
    const sqlCall = calls[1];
    assert.equal(
      sqlCall.url,
      "https://ep-example.us-east-2.aws.neon.tech/sql",
    );
    assert.equal(sqlCall.headers?.["Neon-Connection-String"], URI);
    assert.deepEqual(JSON.parse(sqlCall.body ?? "{}"), {
      query: "select 1 as value",
      params: [],
    });
  });

  it("rejects an empty statement before any request", async () => {
    const calls: Call[] = [];
    await assert.rejects(
      () => runSql(fakeFetch(calls), "k", { projectId: "p", sql: "  " }),
      /non-empty/,
    );
    assert.equal(calls.length, 0);
  });
});

describe("runSqlTransaction", () => {
  it("sends all statements in one transaction body", async () => {
    const calls: Call[] = [];
    const out = (await runSqlTransaction(fakeFetch(calls), "k", {
      projectId: "proj-1",
      sql: ["insert into t values (1)", "insert into t values (2)"],
    })) as unknown[];
    assert.equal(out.length, 2);
    const body = JSON.parse(calls[1].body ?? "{}") as {
      queries: { query: string }[];
    };
    assert.deepEqual(
      body.queries.map((q) => q.query),
      ["insert into t values (1)", "insert into t values (2)"],
    );
  });
});

describe("introspection tools are SQL through the same path", () => {
  it("getDatabaseTables queries information_schema.tables", async () => {
    const calls: Call[] = [];
    await getDatabaseTables(fakeFetch(calls), "k", { projectId: "proj-1" });
    const body = JSON.parse(calls[1].body ?? "{}") as { query: string };
    assert.ok(body.query.includes("information_schema.tables"));
  });

  it("describeTableSchema filters by the quoted table name", async () => {
    const calls: Call[] = [];
    await describeTableSchema(fakeFetch(calls), "k", {
      projectId: "proj-1",
      tableName: "user's",
    });
    const body = JSON.parse(calls[1].body ?? "{}") as { query: string };
    assert.ok(body.query.includes("information_schema.columns"));
    assert.ok(body.query.includes("'user''s'"));
  });

  it("listSlowQueries reads pg_stat_statements with a clamped limit", async () => {
    const calls: Call[] = [];
    await listSlowQueries(fakeFetch(calls), "k", { projectId: "proj-1", limit: 5 });
    const body = JSON.parse(calls[1].body ?? "{}") as { query: string };
    assert.ok(body.query.includes("pg_stat_statements"));
    assert.ok(body.query.endsWith("LIMIT 5"));
  });

  it("explainSqlStatement prefixes EXPLAIN (ANALYZE ... FORMAT JSON)", async () => {
    const calls: Call[] = [];
    await explainSqlStatement(fakeFetch(calls), "k", {
      projectId: "proj-1",
      sql: "select * from t",
    });
    const body = JSON.parse(calls[1].body ?? "{}") as { query: string };
    assert.ok(body.query.startsWith("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) select"));
  });
});

describe("migration two-phase flow", () => {
  it("prepare runs the SQL on a temp branch; complete applies it to the parent and deletes the temp branch", async () => {
    const calls: Call[] = [];
    const fetchFn = fakeFetch(calls);
    const prepared = (await prepareDatabaseMigration(fetchFn, "k", {
      projectId: "proj-1",
      branchId: "br-main",
      migrationSql: "alter table t add column c int",
    })) as { migrationId: string; temporaryBranchId: string };
    assert.equal(prepared.temporaryBranchId, "br-temp-1");
    // The prepare SQL call targeted the temp branch's connection URI.
    const uriCall = calls.find((c) => c.url.includes("connection_uri"));
    assert.ok(new URL(uriCall?.url ?? "").searchParams.get("branch_id") === "br-temp-1");

    const done = (await completeDatabaseMigration(fetchFn, "k", {
      projectId: "proj-1",
      migrationId: prepared.migrationId,
    })) as { applied: boolean; temporaryBranchDeleted: string };
    assert.equal(done.applied, true);
    assert.equal(done.temporaryBranchDeleted, "br-temp-1");
    const deletes = calls.filter((c) => c.method === "DELETE");
    assert.equal(deletes.length, 1);
    assert.ok(deletes[0].url.includes("/branches/br-temp-1"));
  });

  it("complete rejects an unknown migrationId", async () => {
    await assert.rejects(
      () =>
        completeDatabaseMigration(fakeFetch([]), "k", {
          projectId: "proj-1",
          migrationId: "migration-nope",
        }),
      /Unknown migrationId/,
    );
  });
});

describe("HTTP errors", () => {
  it("surface status and the API message", async () => {
    const failing: FetchFn = async () =>
      jsonResponse({ message: "project not found" }, 404, "Not Found");
    await assert.rejects(
      () => listProjects(failing, "k", {}),
      /HTTP 404.*project not found/,
    );
  });
});
