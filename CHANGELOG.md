# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `pgcloud <tool-name> [--json '<arguments>']` exposes every MCP
  tool as a subcommand, plus `pgcloud mcp` and `--version`; the Neon
  API key is read from `NEON_API_KEY`.
- MCP server (`pgcloud mcp`, stdio) with 20 tools covering projects
  (`list_projects`, `describe_project`, `create_project`,
  `delete_project`), branches (`create_branch`, `delete_branch`,
  `describe_branch`, `list_branch_computes`), organizations
  (`list_organizations`), connection strings (`get_connection_string`),
  SQL (`run_sql`, `run_sql_transaction`), introspection
  (`get_database_tables`, `describe_table_schema`, `list_slow_queries`,
  `explain_sql_statement`), and two-phase migrations and query tuning
  (`prepare_`/`complete_database_migration`,
  `prepare_`/`complete_query_tuning`).
- Management calls go to `https://api.neon.tech/api/v2` with the key
  as a Bearer token; SQL runs over the database host's HTTP SQL
  endpoint using the API-resolved connection URI.
- A missing `NEON_API_KEY` fails honestly with an error naming the
  variable, before any request is made.
- All HTTP goes through an injectable fetch function, so the test suite
  runs entirely on hand-written fixtures with no network access.
