#!/usr/bin/env node
/**
 * pgcloud CLI.
 *
 *   pgcloud <tool-name> [--json '<arguments>']
 *   pgcloud mcp
 *   pgcloud --version
 *
 * Every MCP tool is also a subcommand: `pgcloud list_projects`,
 * `pgcloud run_sql --json '{"projectId":"...","sql":"select 1"}'`.
 * Results print as JSON. Reads the Neon API key from NEON_API_KEY.
 * Exit codes: 0 success, 1 API/SQL error, 2 usage error.
 */
import {
  API_KEY_ENV,
  completeDatabaseMigration,
  completeQueryTuning,
  createBranch,
  createProject,
  deleteBranch,
  deleteProject,
  describeBranch,
  describeProject,
  describeTableSchema,
  explainSqlStatement,
  getConnectionString,
  getDatabaseTables,
  listBranchComputes,
  listOrganizations,
  listProjects,
  listSlowQueries,
  prepareDatabaseMigration,
  prepareQueryTuning,
  runSql,
  runSqlTransaction,
  VERSION,
} from "./neon.js";
import type { FetchFn } from "./types.js";

const TOOL_NAMES = [
  "list_projects",
  "describe_project",
  "create_project",
  "delete_project",
  "create_branch",
  "delete_branch",
  "describe_branch",
  "list_branch_computes",
  "list_organizations",
  "get_connection_string",
  "run_sql",
  "run_sql_transaction",
  "get_database_tables",
  "describe_table_schema",
  "list_slow_queries",
  "explain_sql_statement",
  "prepare_database_migration",
  "complete_database_migration",
  "prepare_query_tuning",
  "complete_query_tuning",
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

function usage(): never {
  console.error(`Usage:
  pgcloud <tool-name> [--json '<arguments>']
  pgcloud mcp
  pgcloud --version

Tools:
  ${TOOL_NAMES.join("\n  ")}`);
  process.exit(2);
}

function parseArgsJson(rest: string[]): Record<string, unknown> {
  const idx = rest.indexOf("--json");
  if (idx < 0) {
    const positional = rest.join(" ").trim();
    if (!positional) return {};
    try {
      return JSON.parse(positional) as Record<string, unknown>;
    } catch {
      usage();
    }
  }
  const raw = rest[idx + 1];
  if (!raw) usage();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.error("error: --json value is not valid JSON");
    process.exit(2);
  }
}

async function runTool(
  name: ToolName,
  fetchFn: FetchFn,
  apiKey: string | undefined,
  args: Record<string, unknown>,
): Promise<unknown> {
  // The CLI passes raw JSON arguments; the core validates what it needs.
  const a = args as never;
  switch (name) {
    case "list_projects":
      return listProjects(fetchFn, apiKey, a);
    case "describe_project":
      return describeProject(fetchFn, apiKey, a);
    case "create_project":
      return createProject(fetchFn, apiKey, a);
    case "delete_project":
      return deleteProject(fetchFn, apiKey, a);
    case "create_branch":
      return createBranch(fetchFn, apiKey, a);
    case "delete_branch":
      return deleteBranch(fetchFn, apiKey, a);
    case "describe_branch":
      return describeBranch(fetchFn, apiKey, a);
    case "list_branch_computes":
      return listBranchComputes(fetchFn, apiKey, a);
    case "list_organizations":
      return listOrganizations(fetchFn, apiKey, a);
    case "get_connection_string":
      return getConnectionString(fetchFn, apiKey, a);
    case "run_sql":
      return runSql(fetchFn, apiKey, a);
    case "run_sql_transaction":
      return runSqlTransaction(fetchFn, apiKey, a);
    case "get_database_tables":
      return getDatabaseTables(fetchFn, apiKey, a);
    case "describe_table_schema":
      return describeTableSchema(fetchFn, apiKey, a);
    case "list_slow_queries":
      return listSlowQueries(fetchFn, apiKey, a);
    case "explain_sql_statement":
      return explainSqlStatement(fetchFn, apiKey, a);
    case "prepare_database_migration":
      return prepareDatabaseMigration(fetchFn, apiKey, a);
    case "complete_database_migration":
      return completeDatabaseMigration(fetchFn, apiKey, a);
    case "prepare_query_tuning":
      return prepareQueryTuning(fetchFn, apiKey, a);
    case "complete_query_tuning":
      return completeQueryTuning(fetchFn, apiKey, a);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd || !(TOOL_NAMES as readonly string[]).includes(cmd)) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const apiKey = process.env[API_KEY_ENV];
  try {
    const args = parseArgsJson(rest);
    const out = await runTool(cmd as ToolName, fetchFn, apiKey, args);
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
