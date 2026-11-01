# pgcloud — Build Report

MCP Rebuild 100, Tier B. Clean-room rebuild of the Neon MCP server
(@neondatabase/mcp-server-neon), built from the public tool spec
captured in `harness/fixtures/neon-tools-original.json` only. The
fixture is docs-derived from the original project's public
documentation (the @neondatabase/mcp-server-neon README, the Docker
MCP Catalog tool list, and Neon's MCP docs pages) and is explicitly
labelled a **core-subset**: the documented Neon MCP tool set has 22
tools; pgcloud implements the 20-tool core below, and parity is scored
against that 20-tool subset only. No audited live tool list exists and
no live server was probed. Local build only — nothing pushed or
published, and no live network call was made or claimed at any point.

Identity: repo `pgcloud`, npm `@reneturcios/pgcloud`,
MCP name `io.github.CloudCorpRecords/pgcloud`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `pgcloud: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Neon Postgres projects, branches, SQL,
  and migrations from your MCP client." = **75 chars** (≤100 ✓);
  npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/pgcloud:0.1.0` carries **no** `version`
  field (same shape as the fleet template)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/pgcloud"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (every tool as a subcommand taking
  `--json '<arguments>'`, plus `mcp` and `--version`; exit 2 usage /
  1 API error), `src/mcp.ts`, `src/types.ts`, `src/neon.ts` (core
  logic, `VERSION = "0.1.0"`)
- `test/neon.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to pgcloud)

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the fleet standing rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that are absent from the public spec and
  break exact schema parity. Zod still validates every `tools/call`.
- Management tools are REST calls under
  `https://api.neon.tech/api/v2` with the key from `NEON_API_KEY` sent
  as `Authorization: Bearer`: projects, branches, computes
  (`/projects/{id}/endpoints`), organizations, and the
  `connection_uri` endpoint behind `get_connection_string`.
- SQL tools (`run_sql`, `run_sql_transaction`, and the introspection
  tools) resolve the branch connection URI from the API, then POST to
  the database host's HTTP SQL endpoint (`https://<host>/sql`) with
  the URI in the `Neon-Connection-String` header — the route Neon's
  HTTP SQL access documents. SQL text passes through as given;
  `get_database_tables`, `describe_table_schema`, and
  `list_slow_queries` are `information_schema` / `pg_stat_statements`
  statements and `explain_sql_statement` prefixes
  `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, mirroring how the
  upstream tools are documented to work.
- Migrations and query tuning are two-phase as documented: prepare
  creates a temporary branch and exercises the change there (migration
  SQL is executed on it; a tuning session returns the statement's
  plan), complete applies the migration SQL to the original branch
  and deletes the temporary branch. Session state is an in-memory map
  in the server process, like the upstream's; an unknown session id is
  an honest error.
- A missing key throws before any request, with an error naming
  `NEON_API_KEY`; over MCP this surfaces as an `isError` result
  (verified live over stdio, see below).
- All HTTP flows through an injectable `FetchFn` (types.ts). The test
  suite uses a fake fetch returning hand-written Neon-shaped JSON
  fixtures — **no live call was performed during this build**.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced, including `dist/cli.js` with the
`#!/usr/bin/env node` shebang.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 17
ℹ pass 17
ℹ fail 0
```
Covers: missing/blank key error naming NEON_API_KEY (and no request
made without a key), list_projects URL + limit/search params + Bearer
header, create_project and create_branch body shaping, describe_branch
branch+databases combination, connection_uri query params
(branch_id/database/role/pooled), run_sql URI resolution then POST to
`https://<host>/sql` with the Neon-Connection-String header and
single-query body, transaction body shaping, empty-SQL rejection,
information_schema / pg_stat_statements / EXPLAIN statement shaping
(including quote escaping), the full prepare→complete migration flow
(temp branch targeted, parent applied, temp branch deleted),
unknown-migrationId rejection, and HTTP 404 surfacing the API message.

### 3. CLI / MCP smoke
`--version` → `0.1.0`; unknown command exits 2 with Usage. MCP
`initialize` over stdio → `serverInfo: {"name":"pgcloud",
"version":"0.1.0"}`. A `tools/call` for `list_projects` with
`NEON_API_KEY` unset returned `isError: true` with text
"NEON_API_KEY environment variable is required: set NEON_API_KEY to
a Neon API key and retry". CLI calls against the live API were **not**
run (offline build rule for this wave).

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/neon-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/pgcloud/dist/cli.js mcp" \
    --out .../builds/pgcloud/parity-out
verdict=PASS parity_pct=100.0 original_tools=20 rebuild_tools=20 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
Parity is scored against the labelled 20-tool core-subset fixture
(see Gaps), not against the full 22-tool documented set. Original
side is tools-file mode, so `fixture_results` records
`SKIPPED-TOOLS-FILE-MODE` — expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was copied from searchport's and edited with the
file edit tool: top-level `name`, root package `name`, and root
package `bin` key changed searchport -> pgcloud (dependency ranges
are identical, so the tree is unchanged). **Clean lockfile regen
required before publish** (regenerate with no `node_modules`
present); do not publish from this lockfile as-is. `node_modules` here
is a `cp -a` copy of searchport's; `.bin/tsc` / `.bin/tsx` verified
working.

## Gaps / honest notes

- **Core-subset (documented set not fully implemented).** The
  documented Neon MCP tool set has 22 tools. pgcloud implements 20.
  Omitted documented tools, verbatim:
  - `provision_neon_auth`
  - `__node_version`
  The fixture's `_source` records this subset and the omitted list;
  parity above is against the subset only, never claimed as full-set
  parity.
- No live Neon API call was made (VM egress is blocked and no key is
  available in this environment). Request construction and response
  handling are written against the documented API paths and payload
  shapes as captured in the hand-written test fixtures; live payload
  drift is unverified until the publish wave can smoke with a real
  key.
- Older Neon MCP documentation named the migration pair
  `start_database_migration` / `commit_database_migration` and a
  transient-branch variant workflow; the current documented names
  (`prepare_` / `complete_database_migration`) are what pgcloud
  implements.
- `describe_branch` returns the branch record plus its database list
  as structured JSON; the upstream renders a full object tree
  (schemas/tables/views/functions) built from additional catalog
  queries. The tool/schema contract matches; the rendered depth does
  not.
- Query tuning is session-faithful but simplified: prepare returns the
  statement's execution plan from the temporary branch, and complete
  finalizes the session (temporary branch deleted, apply/discard
  reported). It does not generate or apply index DDL automatically
  the way the hosted upstream's analysis does.
- Migration/tuning sessions live in the server process memory; a
  server restart loses prepared sessions (complete then errors
  honestly rather than guessing).
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.

## Publish-gate remediation (2026-10-27)

Recorded under Rene's 2026-10-27 decision ("Remediate the 6: add param
descriptions + capability-class vet policy, then re-gate") and
`publish/GATE-POLICY.md`, following the standing Wave 2 remediation
pattern. This is an authorized deviation from the parity-faithful
state: descriptions were added to every tool parameter that lacked
one, in the `src/mcp.ts` schema literals only — parameter names,
types and required lists are unchanged.

- Descriptions added: 62 insertion points, covering 62 served
  parameter occurrences (no shared schema consts in this unit; each
  insertion serves exactly one occurrence, in the `TOOLS` literals in
  `src/mcp.ts`). Insertion points, by tool: `list_projects`
  (`limit`, `search`, `org_id`); `describe_project` (`projectId`);
  `create_project` (`name`, `region_id`, `org_id`); `delete_project`
  (`projectId`); `create_branch` (`projectId`, `branchName`,
  `parentBranchId`); `delete_branch` (`projectId`, `branchId`);
  `describe_branch` (`projectId`, `branchId`); `list_branch_computes`
  (`projectId`, `branchId`); `list_organizations` (`search`);
  `get_connection_string` (`projectId`, `branchId`, `databaseName`,
  `roleName`, `pooled`); `run_sql` (`sql`, `projectId`, `branchId`,
  `databaseName`, `roleName`); `run_sql_transaction` (`sql`,
  `projectId`, `branchId`, `databaseName`, `roleName`);
  `get_database_tables` (`projectId`, `branchId`, `databaseName`);
  `describe_table_schema` (`projectId`, `tableName`, `branchId`,
  `databaseName`); `list_slow_queries` (`projectId`, `branchId`,
  `databaseName`, `limit`); `explain_sql_statement` (`sql`,
  `projectId`, `branchId`, `databaseName`);
  `prepare_database_migration` (`migrationSql`, `projectId`,
  `databaseName`, `branchId`); `complete_database_migration`
  (`migrationId`, `projectId`, `databaseName`);
  `prepare_query_tuning` (`sql`, `projectId`, `databaseName`,
  `branchId`); `complete_query_tuning` (`tuningId`, `projectId`,
  `applyChanges`). All 20 tools are covered; every parameter in the
  fresh mcpaudit's 20 PARAMS_UNDESCRIBED issues now carries a
  description written from the parameter's actual semantics in
  `src/neon.ts`.
- Rebuild: `npm run build` exit 0; `tsc --noEmit` exit 0; full
  test suite 17/17 pass (tests 17, pass 17, fail 0).
- Parity harness re-run, verbatim: **PARTIAL, parity_pct 50.0** —
  original_tools=20 rebuild_tools=20 missing=[] extra=[]
  schema_diffs=all 20 tools (`complete_database_migration`,
  `complete_query_tuning`, `create_branch`, `create_project`,
  `delete_branch`, `delete_project`, `describe_branch`,
  `describe_project`, `describe_table_schema`,
  `explain_sql_statement`, `get_connection_string`,
  `get_database_tables`, `list_branch_computes`,
  `list_organizations`, `list_projects`, `list_slow_queries`,
  `prepare_database_migration`, `prepare_query_tuning`, `run_sql`,
  `run_sql_transaction`). Every one of the 62 schema diffs is a
  description addition
  (`*.description: present in rebuild but not in original`); 0
  structural diffs. Structural parity proven independently:
  stripping `description` keys from BOTH the pre- and
  post-remediation tools/list deep-equals (strip-proof RESULT: PASS;
  every description present in PRE is byte-identical in POST — 20
  pre descriptions, 82 post descriptions — and the only additions
  are at inputSchema property paths — 62 additions, 0 removals).
  Adjudication: the description-only diff is the authorized
  remediation itself; structural parity is unchanged. Full record:
  `publish/parity-remediation/pgcloud/parity.json` and
  `publish/parity-remediation/pgcloud/strip-proof.txt`.
- No publish gate was run in this remediation (no mcpaudit/mcpvet),
  and nothing was published.
