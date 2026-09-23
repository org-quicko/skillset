// One table (or view) per file. This barrel is what `drizzle.config.ts` reads
// and what `db/client.ts` hands to Drizzle, so a new table is only registered
// once it is re-exported here.

export * from "./column-types";

// Better Auth's own tables (ADR-0016) — see ./README.md before editing.
export * from "./account";
export * from "./session";
export * from "./user";
export * from "./verification";

export * from "./connection";
export * from "./identity-provider";
export * from "./integration";
export * from "./rate-limit";
export * from "./resource";
export * from "./resource-analytics";
export * from "./resource-directory";
export * from "./resource-install-event";
export * from "./resource-submission";
export * from "./resource-tag";
export * from "./tag";
export * from "./token";
