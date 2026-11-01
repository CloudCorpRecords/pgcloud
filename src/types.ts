/**
 * pgcloud types.
 *
 * One options shape per tool family. Project and branch identifiers are
 * the Neon API's own (`projectId`, `branchId`); SQL tools additionally
 * accept a database name and a role name, both optional because the API
 * resolves defaults. Migration and query-tuning sessions are two-step:
 * a prepare call returns a session id that the matching complete call
 * consumes.
 *
 * HTTP access is described by a minimal response surface so tests can
 * inject a fake fetch and never touch the network.
 */

export interface ListProjectsOptions {
  /** Max projects to return. The API defaults to 10. */
  limit?: number;
  /** Filter projects by name or id. */
  search?: string;
  /** Restrict to one organization. */
  org_id?: string;
}

export interface CreateProjectOptions {
  name?: string;
  region_id?: string;
  org_id?: string;
}

export interface ProjectRef {
  projectId: string;
}

export interface BranchRef extends ProjectRef {
  branchId: string;
}

export interface CreateBranchOptions extends ProjectRef {
  branchName?: string;
  parentBranchId?: string;
}

export interface ListBranchComputesOptions extends ProjectRef {
  branchId?: string;
}

export interface ListOrganizationsOptions {
  search?: string;
}

export interface ConnectionStringOptions extends ProjectRef {
  branchId?: string;
  databaseName?: string;
  roleName?: string;
  pooled?: boolean;
}

export interface SqlOptions extends ProjectRef {
  sql: string;
  branchId?: string;
  databaseName?: string;
  roleName?: string;
}

export interface SqlTransactionOptions extends ProjectRef {
  sql: string[];
  branchId?: string;
  databaseName?: string;
  roleName?: string;
}

export interface DatabaseOptions extends ProjectRef {
  branchId?: string;
  databaseName?: string;
}

export interface DescribeTableSchemaOptions extends ProjectRef {
  tableName: string;
  branchId?: string;
  databaseName?: string;
}

export interface SlowQueriesOptions extends DatabaseOptions {
  limit?: number;
}

export interface PrepareMigrationOptions extends ProjectRef {
  migrationSql: string;
  databaseName?: string;
  branchId?: string;
}

export interface CompleteMigrationOptions extends ProjectRef {
  migrationId: string;
  databaseName?: string;
}

export interface PrepareTuningOptions extends ProjectRef {
  sql: string;
  databaseName?: string;
  branchId?: string;
}

export interface CompleteTuningOptions extends ProjectRef {
  tuningId: string;
  applyChanges: boolean;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
