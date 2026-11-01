/**
 * pgcloud MCP server: 20 tools covering Neon projects, branches,
 * computes, organizations, connection strings, SQL execution,
 * introspection, two-phase migrations, and query tuning sessions.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"), which
 * breaks exact tool-list/schema parity with the spec. This file serves
 * tools/list with the spec's exact input schemas as explicit literals,
 * while zod still validates every tools/call argument set. Tool names,
 * parameters, and required sets are taken from the public spec.
 *
 * The Neon API key is read from NEON_API_KEY at call time; a missing
 * key returns an honest isError result naming the variable instead of
 * failing the handshake.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
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

const ListProjectsArgs = z.object({
  limit: z.number().optional(),
  search: z.string().optional(),
  org_id: z.string().optional(),
});

const ProjectIdArgs = z.object({
  projectId: z.string(),
});

const CreateProjectArgs = z.object({
  name: z.string().optional(),
  region_id: z.string().optional(),
  org_id: z.string().optional(),
});

const CreateBranchArgs = z.object({
  projectId: z.string(),
  branchName: z.string().optional(),
  parentBranchId: z.string().optional(),
});

const BranchArgs = z.object({
  projectId: z.string(),
  branchId: z.string(),
});

const ListBranchComputesArgs = z.object({
  projectId: z.string(),
  branchId: z.string().optional(),
});

const ListOrganizationsArgs = z.object({
  search: z.string().optional(),
});

const ConnectionStringArgs = z.object({
  projectId: z.string(),
  branchId: z.string().optional(),
  databaseName: z.string().optional(),
  roleName: z.string().optional(),
  pooled: z.boolean().optional(),
});

const SqlArgs = z.object({
  sql: z.string(),
  projectId: z.string(),
  branchId: z.string().optional(),
  databaseName: z.string().optional(),
  roleName: z.string().optional(),
});

const SqlTransactionArgs = z.object({
  sql: z.array(z.string()),
  projectId: z.string(),
  branchId: z.string().optional(),
  databaseName: z.string().optional(),
  roleName: z.string().optional(),
});

const DatabaseArgs = z.object({
  projectId: z.string(),
  branchId: z.string().optional(),
  databaseName: z.string().optional(),
});

const DescribeTableSchemaArgs = z.object({
  projectId: z.string(),
  tableName: z.string(),
  branchId: z.string().optional(),
  databaseName: z.string().optional(),
});

const SlowQueriesArgs = z.object({
  projectId: z.string(),
  branchId: z.string().optional(),
  databaseName: z.string().optional(),
  limit: z.number().optional(),
});

const PrepareMigrationArgs = z.object({
  migrationSql: z.string(),
  projectId: z.string(),
  databaseName: z.string().optional(),
  branchId: z.string().optional(),
});

const CompleteMigrationArgs = z.object({
  migrationId: z.string(),
  projectId: z.string(),
  databaseName: z.string().optional(),
});

const PrepareTuningArgs = z.object({
  sql: z.string(),
  projectId: z.string(),
  databaseName: z.string().optional(),
  branchId: z.string().optional(),
});

const CompleteTuningArgs = z.object({
  tuningId: z.string(),
  projectId: z.string(),
  applyChanges: z.boolean(),
});

const TOOLS = [
  {
    name: "list_projects",
    description: "List all Neon projects in your account.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Maximum number of Neon projects to return." },
        search: { type: "string", description: "Optional search term to filter projects by name." },
        org_id: { type: "string", description: "Optional Neon organization ID; when given, only projects belonging to that organization are listed." },
      },
      required: [],
    },
  },
  {
    name: "describe_project",
    description: "Describes a Neon project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project to describe." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "create_project",
    description: "Create a new Neon project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Optional name for the new Neon project; when omitted, Neon assigns a default name." },
        region_id: { type: "string", description: "Optional Neon region ID in which to create the project, such as aws-us-east-1." },
        org_id: { type: "string", description: "Optional Neon organization ID that will own the new project." },
      },
      required: [],
    },
  },
  {
    name: "delete_project",
    description: "Delete a Neon project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project to delete, together with everything in it." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "create_branch",
    description: "Create a branch in a Neon project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project in which to create the branch." },
        branchName: { type: "string", description: "Optional name for the new branch; when omitted, Neon assigns a default name." },
        parentBranchId: { type: "string", description: "Optional ID of the branch to copy from; when omitted, the branch is created from the project's default branch." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "delete_branch",
    description: "Delete a branch from a Neon project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project that owns the branch." },
        branchId: { type: "string", description: "ID of the branch to delete." },
      },
      required: ["projectId", "branchId"],
    },
  },
  {
    name: "describe_branch",
    description: "Get a tree view of all objects in a branch, including databases, schemas, tables, views, and functions",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project that owns the branch." },
        branchId: { type: "string", description: "ID of the branch to describe, including the databases it holds." },
      },
      required: ["projectId", "branchId"],
    },
  },
  {
    name: "list_branch_computes",
    description: "List compute endpoints for a project or a specific branch, including compute ID, type, and size.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project whose compute endpoints to list." },
        branchId: { type: "string", description: "Optional ID of a branch; when given, only compute endpoints for that branch are listed." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "list_organizations",
    description: "List all organizations that the current user has access to, optionally filtered by a search term.",
    inputSchema: {
      type: "object" as const,
      properties: {
        search: { type: "string", description: "Optional search term to filter organizations by name." },
      },
      required: [],
    },
  },
  {
    name: "get_connection_string",
    description: "Get a PostgreSQL connection string for a Neon database with all parameters being optional",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project whose connection string to return." },
        branchId: { type: "string", description: "Optional ID of the branch to connect to; when omitted, the project's default branch is used." },
        databaseName: { type: "string", description: "Optional name of the database to connect to; when omitted, the project's default database is used." },
        roleName: { type: "string", description: "Optional name of the database role to connect as; when omitted, the default role is used." },
        pooled: { type: "boolean", description: "Optional flag: when true, return a pooled connection string (through Neon's connection pooler); when false or omitted, return a direct connection string." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "run_sql",
    description: "Execute a single SQL statement against a Neon database.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string", description: "The single SQL statement to execute against the Neon database." },
        projectId: { type: "string", description: "ID of the Neon project that owns the database." },
        branchId: { type: "string", description: "Optional ID of the branch to run against; when omitted, the project's default branch is used." },
        databaseName: { type: "string", description: "Optional name of the database to run against; when omitted, the project's default database is used." },
        roleName: { type: "string", description: "Optional name of the database role to run as; when omitted, the default role is used." },
      },
      required: ["sql", "projectId"],
    },
  },
  {
    name: "run_sql_transaction",
    description: "Execute a SQL transaction against a Neon database, should be used for multiple SQL statements.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "array", items: { type: "string" }, description: "Array of SQL statements to execute together in a single transaction against the Neon database." },
        projectId: { type: "string", description: "ID of the Neon project that owns the database." },
        branchId: { type: "string", description: "Optional ID of the branch to run against; when omitted, the project's default branch is used." },
        databaseName: { type: "string", description: "Optional name of the database to run against; when omitted, the project's default database is used." },
        roleName: { type: "string", description: "Optional name of the database role to run as; when omitted, the default role is used." },
      },
      required: ["sql", "projectId"],
    },
  },
  {
    name: "get_database_tables",
    description: "Get all tables in a Neon database",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project that owns the database." },
        branchId: { type: "string", description: "Optional ID of the branch whose tables to list; when omitted, the project's default branch is used." },
        databaseName: { type: "string", description: "Optional name of the database whose tables to list; when omitted, the project's default database is used." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "describe_table_schema",
    description: "Describe the schema of a table in a Neon database",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project that owns the table." },
        tableName: { type: "string", description: "Name of the table whose columns to describe." },
        branchId: { type: "string", description: "Optional ID of the branch containing the table; when omitted, the project's default branch is used." },
        databaseName: { type: "string", description: "Optional name of the database containing the table; when omitted, the project's default database is used." },
      },
      required: ["projectId", "tableName"],
    },
  },
  {
    name: "list_slow_queries",
    description: "List slow queries from pg_stat_statements, ordered by mean execution time.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "ID of the Neon project that owns the database." },
        branchId: { type: "string", description: "Optional ID of the branch to inspect; when omitted, the project's default branch is used." },
        databaseName: { type: "string", description: "Optional name of the database to inspect; when omitted, the project's default database is used." },
        limit: { type: "number", description: "Optional maximum number of slow queries to return, clamped to between 1 and 100; defaults to 10." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "explain_sql_statement",
    description: "Describe the PostgreSQL query execution plan for a SQL statement by running EXPLAIN in the database",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string", description: "The SQL statement whose PostgreSQL execution plan to return, run under EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)." },
        projectId: { type: "string", description: "ID of the Neon project that owns the database." },
        branchId: { type: "string", description: "Optional ID of the branch to explain against; when omitted, the project's default branch is used." },
        databaseName: { type: "string", description: "Optional name of the database to explain against; when omitted, the project's default database is used." },
      },
      required: ["sql", "projectId"],
    },
  },
  {
    name: "prepare_database_migration",
    description: "Perform a database schema migration by executing the given SQL on a temporary branch for safety, ready to complete onto the main branch.",
    inputSchema: {
      type: "object" as const,
      properties: {
        migrationSql: { type: "string", description: "The migration SQL to test on a temporary branch before it is applied to the original branch." },
        projectId: { type: "string", description: "ID of the Neon project that owns the database to migrate." },
        databaseName: { type: "string", description: "Optional name of the database to migrate; when omitted, the project's default database is used." },
        branchId: { type: "string", description: "Optional ID of the branch to migrate; the temporary branch is created from it and completion applies the migration back to it. When omitted, the project's default branch is used." },
      },
      required: ["migrationSql", "projectId"],
    },
  },
  {
    name: "complete_database_migration",
    description: "Complete a database migration when the user confirms the migration is ready to be applied to the main branch.",
    inputSchema: {
      type: "object" as const,
      properties: {
        migrationId: { type: "string", description: "ID of the prepared migration session returned by prepare_database_migration." },
        projectId: { type: "string", description: "ID of the Neon project the migration was prepared for; must match the prepared migration's project." },
        databaseName: { type: "string", description: "Optional name of the database to apply the migration to; when omitted, the database recorded when the migration was prepared is used." },
      },
      required: ["migrationId", "projectId"],
    },
  },
  {
    name: "prepare_query_tuning",
    description: "Analyze a slow query or DML statement on a temporary branch, returning its execution plan to suggest optimizations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string", description: "The slow query or DML statement to analyze on a temporary branch; its execution plan is returned to suggest optimizations." },
        projectId: { type: "string", description: "ID of the Neon project that owns the database." },
        databaseName: { type: "string", description: "Optional name of the database the statement runs against; when omitted, the project's default database is used." },
        branchId: { type: "string", description: "Optional ID of the branch to tune against; the temporary tuning branch is created from it. When omitted, the project's default branch is used." },
      },
      required: ["sql", "projectId"],
    },
  },
  {
    name: "complete_query_tuning",
    description: "Complete a query tuning session by either applying the changes to the main branch or discarding them.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tuningId: { type: "string", description: "ID of the query tuning session returned by prepare_query_tuning." },
        projectId: { type: "string", description: "ID of the Neon project the tuning session was prepared for; must match the session's project." },
        applyChanges: { type: "boolean", description: "Whether to apply the tuning session's changes to the original branch (true) or discard them (false); the temporary branch is deleted either way." },
      },
      required: ["tuningId", "projectId", "applyChanges"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "pgcloud", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const apiKey = process.env.NEON_API_KEY;
  try {
    let out: unknown;
    switch (name) {
      case "list_projects":
        out = await listProjects(fetchFn, apiKey, ListProjectsArgs.parse(args ?? {}));
        break;
      case "describe_project":
        out = await describeProject(fetchFn, apiKey, ProjectIdArgs.parse(args ?? {}));
        break;
      case "create_project":
        out = await createProject(fetchFn, apiKey, CreateProjectArgs.parse(args ?? {}));
        break;
      case "delete_project":
        out = await deleteProject(fetchFn, apiKey, ProjectIdArgs.parse(args ?? {}));
        break;
      case "create_branch":
        out = await createBranch(fetchFn, apiKey, CreateBranchArgs.parse(args ?? {}));
        break;
      case "delete_branch":
        out = await deleteBranch(fetchFn, apiKey, BranchArgs.parse(args ?? {}));
        break;
      case "describe_branch":
        out = await describeBranch(fetchFn, apiKey, BranchArgs.parse(args ?? {}));
        break;
      case "list_branch_computes":
        out = await listBranchComputes(fetchFn, apiKey, ListBranchComputesArgs.parse(args ?? {}));
        break;
      case "list_organizations":
        out = await listOrganizations(fetchFn, apiKey, ListOrganizationsArgs.parse(args ?? {}));
        break;
      case "get_connection_string":
        out = await getConnectionString(fetchFn, apiKey, ConnectionStringArgs.parse(args ?? {}));
        break;
      case "run_sql":
        out = await runSql(fetchFn, apiKey, SqlArgs.parse(args ?? {}));
        break;
      case "run_sql_transaction":
        out = await runSqlTransaction(fetchFn, apiKey, SqlTransactionArgs.parse(args ?? {}));
        break;
      case "get_database_tables":
        out = await getDatabaseTables(fetchFn, apiKey, DatabaseArgs.parse(args ?? {}));
        break;
      case "describe_table_schema":
        out = await describeTableSchema(fetchFn, apiKey, DescribeTableSchemaArgs.parse(args ?? {}));
        break;
      case "list_slow_queries":
        out = await listSlowQueries(fetchFn, apiKey, SlowQueriesArgs.parse(args ?? {}));
        break;
      case "explain_sql_statement":
        out = await explainSqlStatement(fetchFn, apiKey, SqlArgs.parse(args ?? {}));
        break;
      case "prepare_database_migration":
        out = await prepareDatabaseMigration(fetchFn, apiKey, PrepareMigrationArgs.parse(args ?? {}));
        break;
      case "complete_database_migration":
        out = await completeDatabaseMigration(fetchFn, apiKey, CompleteMigrationArgs.parse(args ?? {}));
        break;
      case "prepare_query_tuning":
        out = await prepareQueryTuning(fetchFn, apiKey, PrepareTuningArgs.parse(args ?? {}));
        break;
      case "complete_query_tuning":
        out = await completeQueryTuning(fetchFn, apiKey, CompleteTuningArgs.parse(args ?? {}));
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
