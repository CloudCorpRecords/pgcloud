# pgcloud

pgcloud puts a Neon Postgres account within reach of an MCP client or
a terminal. Projects and their branches can be listed, described,
created, and deleted; compute endpoints and organizations can be
inspected; and any database in a project can be queried directly —
single statements, multi-statement transactions, table and column
introspection, slow-query reports, and execution plans. Schema changes
follow Neon's two-phase pattern: a migration or tuning session is
prepared on a temporary branch, exercised there, and only then
completed onto the original branch.

A Neon API key is required. Put it in the `NEON_API_KEY` environment
variable; it is sent to the Neon API as a Bearer token and never
appears in output. When the variable is missing, every call fails with
an error that names it.

## Install

```bash
npx @reneturcios/pgcloud list_projects
```

Or run the container image:

```bash
docker run -i -e NEON_API_KEY ghcr.io/cloudcorprecords/pgcloud
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

Every MCP tool is also a CLI subcommand. Tool arguments are passed as
one JSON object with `--json`:

```bash
export NEON_API_KEY=<your Neon API key>

pgcloud list_projects
pgcloud list_projects --json '{"limit": 5, "search": "billing"}'
pgcloud describe_project --json '{"projectId": "snowy-pond-12345678"}'
pgcloud create_branch --json '{"projectId": "snowy-pond-12345678", "branchName": "dev"}'
pgcloud run_sql --json '{"projectId": "snowy-pond-12345678", "sql": "select now()"}'
pgcloud get_connection_string --json '{"projectId": "snowy-pond-12345678", "pooled": true}'

pgcloud --version
```

Results print as JSON. Exit codes: `0` on success, `1` when an API or
SQL call fails (including a missing `NEON_API_KEY`), `2` for usage
errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/pgcloud mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "pgcloud": {
      "command": "npx",
      "args": ["-y", "@reneturcios/pgcloud", "mcp"],
      "env": { "NEON_API_KEY": "your Neon API key" }
    }
  }
}
```

### Tools

| Tool | Input (required in bold) | What it does |
| --- | --- | --- |
| `list_projects` | `limit`, `search`, `org_id` | Lists projects in the account. |
| `describe_project` | **`projectId`** | Describes one project. |
| `create_project` | `name`, `region_id`, `org_id` | Creates a project. |
| `delete_project` | **`projectId`** | Deletes a project and its resources. |
| `create_branch` | **`projectId`**, `branchName`, `parentBranchId` | Creates a branch with a read-write compute. |
| `delete_branch` | **`projectId`**, **`branchId`** | Deletes a branch. |
| `describe_branch` | **`projectId`**, **`branchId`** | Branch record plus its databases. |
| `list_branch_computes` | **`projectId`**, `branchId` | Lists compute endpoints. |
| `list_organizations` | `search` | Lists organizations the user can access. |
| `get_connection_string` | **`projectId`**, `branchId`, `databaseName`, `roleName`, `pooled` | Resolves a Postgres connection string. |
| `run_sql` | **`sql`**, **`projectId`**, `branchId`, `databaseName`, `roleName` | Runs one SQL statement. |
| `run_sql_transaction` | **`sql`** (array), **`projectId`**, … | Runs statements in one transaction. |
| `get_database_tables` | **`projectId`**, `branchId`, `databaseName` | Lists tables via `information_schema`. |
| `describe_table_schema` | **`projectId`**, **`tableName`**, … | Lists a table's columns. |
| `list_slow_queries` | **`projectId`**, `limit`, … | Slowest queries from `pg_stat_statements`. |
| `explain_sql_statement` | **`sql`**, **`projectId`**, … | Returns the EXPLAIN plan for a statement. |
| `prepare_database_migration` | **`migrationSql`**, **`projectId`**, … | Runs migration SQL on a temporary branch. |
| `complete_database_migration` | **`migrationId`**, **`projectId`**, … | Applies a prepared migration to the original branch. |
| `prepare_query_tuning` | **`sql`**, **`projectId`**, … | Opens a tuning session on a temporary branch with the plan. |
| `complete_query_tuning` | **`tuningId`**, **`projectId`**, **`applyChanges`** | Closes a tuning session, applying or discarding. |

Management calls go to `https://api.neon.tech/api/v2`. SQL calls first
resolve the branch's connection URI from the API, then POST the
statement to the database host's HTTP SQL endpoint with the URI in the
`Neon-Connection-String` header; SQL text is passed through as given.
Migration and tuning sessions are held in the server process, so a
session must be completed by the same process that prepared it.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
