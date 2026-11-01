/**
 * pgcloud core: Neon project, branch, SQL, migration, and tuning tools
 * against the Neon API.
 *
 * Management calls are REST requests under https://api.neon.tech/api/v2
 * with the API key from NEON_API_KEY sent as a Bearer token:
 *
 *   projects      GET/POST /projects, GET/DELETE /projects/{id}
 *   branches      POST /projects/{id}/branches,
 *                 GET/DELETE /projects/{id}/branches/{branchId}
 *   computes      GET /projects/{id}/endpoints?branch_id=...
 *   organizations GET /organizations
 *   conn string   GET /projects/{id}/connection_uri
 *
 * SQL execution follows the same route the upstream server documents:
 * resolve the branch's connection URI from the API, then POST the
 * statement to the database host's HTTP SQL endpoint with the URI in
 * the Neon-Connection-String header. SQL text is passed through as
 * given; introspection tools (tables, table schema, slow queries,
 * explain) are ordinary SQL statements built here and run through that
 * same path.
 *
 * Migrations and query tuning are two-phase, as documented: prepare
 * creates a temporary branch and exercises the change there, complete
 * applies it to the original branch and deletes the temporary branch.
 * Session state is in-memory per server process, like the upstream.
 *
 * A missing API key is an error before any request is made, and the
 * error names the NEON_API_KEY variable. All HTTP goes through an
 * injected FetchFn so everything is testable offline.
 */
import type {
  CompleteMigrationOptions,
  CompleteTuningOptions,
  ConnectionStringOptions,
  CreateBranchOptions,
  CreateProjectOptions,
  DatabaseOptions,
  DescribeTableSchemaOptions,
  FetchFn,
  ListBranchComputesOptions,
  ListOrganizationsOptions,
  ListProjectsOptions,
  PrepareMigrationOptions,
  PrepareTuningOptions,
  SlowQueriesOptions,
  SqlOptions,
  SqlTransactionOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const API_BASE = "https://api.neon.tech/api/v2";

export const API_KEY_ENV = "NEON_API_KEY";

/** The honest missing-key error. Names the variable, never a value. */
export function requireApiKey(apiKey: string | undefined): string {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    throw new Error(
      "NEON_API_KEY environment variable is required: set NEON_API_KEY to a Neon API key and retry",
    );
  }
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmpty(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

/** One management-API request; returns the parsed JSON payload. */
export async function apiRequest(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  method: string,
  path: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
): Promise<unknown> {
  const key = requireApiKey(apiKey);
  const qs = options.query
    ? `?${new URLSearchParams(options.query).toString()}`
    : "";
  let response;
  try {
    response = await fetchFn(`${API_BASE}${path}${qs}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch (err) {
    throw new Error(
      `Neon API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && typeof payload.message === "string") {
        detail = `: ${payload.message}`;
      }
    } catch {
      // keep the status-only error
    }
    throw new Error(
      `Neon API request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail}`,
    );
  }
  if (response.status === 204) return { ok: true, status: 204 };
  try {
    return await response.json();
  } catch {
    return { ok: true, status: response.status };
  }
}

/** List projects in the account. */
export async function listProjects(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListProjectsOptions,
): Promise<unknown> {
  const query: Record<string, string> = {};
  if (options.limit !== undefined) query.limit = String(options.limit);
  if (options.search) query.search = options.search;
  if (options.org_id) query.org_id = options.org_id;
  return apiRequest(fetchFn, apiKey, "GET", "/projects", { query });
}

/** Describe one project (branches and databases included upstream). */
export async function describeProject(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: { projectId: string },
): Promise<unknown> {
  const projectId = requireNonEmpty(options.projectId, "projectId");
  return apiRequest(fetchFn, apiKey, "GET", `/projects/${encodeURIComponent(projectId)}`);
}

/** Create a project. */
export async function createProject(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateProjectOptions,
): Promise<unknown> {
  const project: Record<string, unknown> = {};
  if (options.name) project.name = options.name;
  if (options.region_id) project.region_id = options.region_id;
  if (options.org_id) project.org_id = options.org_id;
  return apiRequest(fetchFn, apiKey, "POST", "/projects", {
    body: { project },
  });
}

/** Delete a project and everything in it. */
export async function deleteProject(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: { projectId: string },
): Promise<unknown> {
  const projectId = requireNonEmpty(options.projectId, "projectId");
  return apiRequest(
    fetchFn,
    apiKey,
    "DELETE",
    `/projects/${encodeURIComponent(projectId)}`,
  );
}

/** Create a branch, with a read-write compute endpoint like the console. */
export async function createBranch(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateBranchOptions,
): Promise<unknown> {
  const projectId = requireNonEmpty(options.projectId, "projectId");
  const branch: Record<string, unknown> = {};
  if (options.branchName) branch.name = options.branchName;
  if (options.parentBranchId) branch.parent_id = options.parentBranchId;
  return apiRequest(
    fetchFn,
    apiKey,
    "POST",
    `/projects/${encodeURIComponent(projectId)}/branches`,
    { body: { branch, endpoints: [{ type: "read_write" }] } },
  );
}

/** Delete a branch. */
export async function deleteBranch(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: { projectId: string; branchId: string },
): Promise<unknown> {
  const projectId = requireNonEmpty(options.projectId, "projectId");
  const branchId = requireNonEmpty(options.branchId, "branchId");
  return apiRequest(
    fetchFn,
    apiKey,
    "DELETE",
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
  );
}

/** Describe a branch together with the databases it holds. */
export async function describeBranch(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: { projectId: string; branchId: string },
): Promise<unknown> {
  const projectId = requireNonEmpty(options.projectId, "projectId");
  const branchId = requireNonEmpty(options.branchId, "branchId");
  const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`;
  const branch = await apiRequest(fetchFn, apiKey, "GET", base);
  const databases = await apiRequest(fetchFn, apiKey, "GET", `${base}/databases`);
  return { branch, databases };
}

/** List compute endpoints for a project, optionally for one branch. */
export async function listBranchComputes(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListBranchComputesOptions,
): Promise<unknown> {
  const projectId = requireNonEmpty(options.projectId, "projectId");
  const query: Record<string, string> = {};
  if (options.branchId) query.branch_id = options.branchId;
  return apiRequest(
    fetchFn,
    apiKey,
    "GET",
    `/projects/${encodeURIComponent(projectId)}/endpoints`,
    { query },
  );
}

/** List organizations the user can access. */
export async function listOrganizations(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListOrganizationsOptions,
): Promise<unknown> {
  const query: Record<string, string> = {};
  if (options.search) query.search = options.search;
  return apiRequest(fetchFn, apiKey, "GET", "/organizations", { query });
}

/** Resolve a connection string (the API's connection_uri endpoint). */
export async function getConnectionString(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ConnectionStringOptions,
): Promise<unknown> {
  const projectId = requireNonEmpty(options.projectId, "projectId");
  const query: Record<string, string> = {};
  if (options.branchId) query.branch_id = options.branchId;
  if (options.databaseName) query.database = options.databaseName;
  if (options.roleName) query.role = options.roleName;
  if (options.pooled !== undefined) query.pooled = String(options.pooled);
  const payload = await apiRequest(
    fetchFn,
    apiKey,
    "GET",
    `/projects/${encodeURIComponent(projectId)}/connection_uri`,
    { query },
  );
  if (isRecord(payload) && typeof payload.uri === "string") return payload.uri;
  return payload;
}

/** Extract the bare connection URI string from a resolved value. */
export function connectionUriOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.uri === "string") return value.uri;
  throw new Error("Neon API did not return a connection URI for this database");
}

/**
 * Run statements over Neon's HTTP SQL endpoint for a branch: POST to
 * https://<host>/sql with the connection URI in the
 * Neon-Connection-String header. One statement uses the single-query
 * body; several use the transaction body and run atomically.
 */
export async function executeSql(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ConnectionStringOptions,
  statements: string[],
): Promise<unknown> {
  requireApiKey(apiKey);
  const uri = connectionUriOf(
    await getConnectionString(fetchFn, apiKey, options),
  );
  const host = new URL(uri).host;
  const single = statements.length === 1;
  const body = single
    ? { query: statements[0], params: [] }
    : {
        queries: statements.map((query) => ({ query, params: [] })),
      };
  let response;
  try {
    response = await fetchFn(`https://${host}/sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Neon-Connection-String": uri,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Neon SQL request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Neon SQL request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    );
  }
  return response.json();
}

/** Execute a single SQL statement. */
export async function runSql(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: SqlOptions,
): Promise<unknown> {
  const sql = requireNonEmpty(options.sql, "sql");
  return executeSql(fetchFn, apiKey, options, [sql]);
}

/** Execute several statements in one transaction. */
export async function runSqlTransaction(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: SqlTransactionOptions,
): Promise<unknown> {
  if (!Array.isArray(options.sql) || options.sql.length === 0) {
    throw new Error("sql must be a non-empty array of SQL statements");
  }
  const statements = options.sql.map((s) => requireNonEmpty(s, "sql"));
  return executeSql(fetchFn, apiKey, options, statements);
}

const TABLES_SQL =
  "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name";

/** List the tables in a database (an information_schema query). */
export async function getDatabaseTables(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: DatabaseOptions,
): Promise<unknown> {
  return executeSql(fetchFn, apiKey, options, [TABLES_SQL]);
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Describe one table's columns (an information_schema query). */
export async function describeTableSchema(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: DescribeTableSchemaOptions,
): Promise<unknown> {
  const tableName = requireNonEmpty(options.tableName, "tableName");
  const sql =
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
    `WHERE table_name = ${quoteLiteral(tableName)} ORDER BY ordinal_position`;
  return executeSql(fetchFn, apiKey, options, [sql]);
}

const SLOW_QUERIES_SQL =
  "SELECT query, calls, mean_exec_time, total_exec_time, rows FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT ";

/** Slowest queries by mean execution time (needs pg_stat_statements). */
export async function listSlowQueries(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: SlowQueriesOptions,
): Promise<unknown> {
  const limit =
    options.limit !== undefined && Number.isFinite(options.limit)
      ? Math.min(100, Math.max(1, Math.floor(options.limit)))
      : 10;
  return executeSql(fetchFn, apiKey, options, [`${SLOW_QUERIES_SQL}${limit}`]);
}

/** EXPLAIN a statement and return its execution plan. */
export async function explainSqlStatement(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: SqlOptions,
): Promise<unknown> {
  const sql = requireNonEmpty(options.sql, "sql");
  return executeSql(fetchFn, apiKey, options, [
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
  ]);
}

interface MigrationSession {
  projectId: string;
  databaseName?: string;
  parentBranchId?: string;
  tempBranchId: string;
  migrationSql: string;
}

interface TuningSession {
  projectId: string;
  databaseName?: string;
  branchId?: string;
  tempBranchId: string;
  sql: string;
}

const migrations = new Map<string, MigrationSession>();
const tuningSessions = new Map<string, TuningSession>();
let sessionCounter = 0;

function nextSessionId(prefix: string): string {
  sessionCounter += 1;
  return `${prefix}-${sessionCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function branchIdOf(payload: unknown): string {
  if (isRecord(payload) && isRecord(payload.branch) && typeof payload.branch.id === "string") {
    return payload.branch.id;
  }
  throw new Error("Neon API did not return a branch id for the temporary branch");
}

/**
 * Prepare a database migration: create a temporary branch, run the
 * migration SQL there, and hold the session for completion.
 */
export async function prepareDatabaseMigration(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: PrepareMigrationOptions,
): Promise<unknown> {
  const migrationSql = requireNonEmpty(options.migrationSql, "migrationSql");
  const created = await createBranch(fetchFn, apiKey, {
    projectId: options.projectId,
    branchName: `pgcloud-migration-${Date.now()}`,
    parentBranchId: options.branchId,
  });
  const tempBranchId = branchIdOf(created);
  const migrationId = nextSessionId("migration");
  migrations.set(migrationId, {
    projectId: options.projectId,
    databaseName: options.databaseName,
    parentBranchId: options.branchId,
    tempBranchId,
    migrationSql,
  });
  const testResult = await executeSql(
    fetchFn,
    apiKey,
    {
      projectId: options.projectId,
      branchId: tempBranchId,
      databaseName: options.databaseName,
    },
    [migrationSql],
  );
  return {
    migrationId,
    projectId: options.projectId,
    temporaryBranchId: tempBranchId,
    databaseName: options.databaseName,
    migrationSql,
    testResult,
    message:
      "Migration applied to a temporary branch. Test it with run_sql against the temporary branch, then call complete_database_migration to apply it to the original branch.",
  };
}

/**
 * Complete a prepared migration: apply its SQL to the original branch
 * and delete the temporary branch.
 */
export async function completeDatabaseMigration(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CompleteMigrationOptions,
): Promise<unknown> {
  const migrationId = requireNonEmpty(options.migrationId, "migrationId");
  const session = migrations.get(migrationId);
  if (!session) {
    throw new Error(
      `Unknown migrationId: ${migrationId} (migration sessions live in this server process; prepare the migration again)`,
    );
  }
  if (session.projectId !== options.projectId) {
    throw new Error("projectId does not match the prepared migration's project");
  }
  const applied = await executeSql(
    fetchFn,
    apiKey,
    {
      projectId: session.projectId,
      branchId: session.parentBranchId,
      databaseName: options.databaseName ?? session.databaseName,
    },
    [session.migrationSql],
  );
  await deleteBranch(fetchFn, apiKey, {
    projectId: session.projectId,
    branchId: session.tempBranchId,
  });
  migrations.delete(migrationId);
  return {
    migrationId,
    projectId: session.projectId,
    applied: true,
    temporaryBranchDeleted: session.tempBranchId,
    result: applied,
  };
}

/**
 * Prepare a query tuning session: create a temporary branch and return
 * the statement's execution plan there.
 */
export async function prepareQueryTuning(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: PrepareTuningOptions,
): Promise<unknown> {
  const sql = requireNonEmpty(options.sql, "sql");
  const created = await createBranch(fetchFn, apiKey, {
    projectId: options.projectId,
    branchName: `pgcloud-tuning-${Date.now()}`,
    parentBranchId: options.branchId,
  });
  const tempBranchId = branchIdOf(created);
  const tuningId = nextSessionId("tuning");
  tuningSessions.set(tuningId, {
    projectId: options.projectId,
    databaseName: options.databaseName,
    branchId: options.branchId,
    tempBranchId,
    sql,
  });
  const plan = await executeSql(
    fetchFn,
    apiKey,
    {
      projectId: options.projectId,
      branchId: tempBranchId,
      databaseName: options.databaseName,
    },
    [`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`],
  );
  return {
    tuningId,
    projectId: options.projectId,
    temporaryBranchId: tempBranchId,
    sql,
    executionPlan: plan,
    message:
      "Tuning session open on a temporary branch. Experiment there with run_sql, then call complete_query_tuning with applyChanges true to keep the session's outcome on the original branch or false to discard it.",
  };
}

/**
 * Complete a tuning session: delete the temporary branch and report
 * whether the session's changes were marked applied or discarded.
 */
export async function completeQueryTuning(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CompleteTuningOptions,
): Promise<unknown> {
  const tuningId = requireNonEmpty(options.tuningId, "tuningId");
  const session = tuningSessions.get(tuningId);
  if (!session) {
    throw new Error(
      `Unknown tuningId: ${tuningId} (tuning sessions live in this server process; prepare the session again)`,
    );
  }
  if (session.projectId !== options.projectId) {
    throw new Error("projectId does not match the tuning session's project");
  }
  await deleteBranch(fetchFn, apiKey, {
    projectId: session.projectId,
    branchId: session.tempBranchId,
  });
  tuningSessions.delete(tuningId);
  return {
    tuningId,
    projectId: session.projectId,
    appliedChanges: options.applyChanges,
    temporaryBranchDeleted: session.tempBranchId,
  };
}
