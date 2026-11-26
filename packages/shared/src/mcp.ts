import { z } from "zod";
import { MCP_DESCRIPTION_MAX_LENGTH } from "./mcp-rules.js";
import { PublisherSchema } from "./skill.js";
import { TagSchema } from "./tag.js";
import { timestamp } from "./timestamp.js";

export const MCP_REGISTRIES = ["npm", "pypi", "oci", "nuget", "cargo", "mcpb"] as const;
export type McpRegistry = (typeof MCP_REGISTRIES)[number];

export const MCP_TRANSPORTS = ["sse", "http", "stdio", "websocket"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const McpEnvironmentVariableSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
});
export type McpEnvironmentVariable = z.infer<typeof McpEnvironmentVariableSchema>;

export const McpPackageSchema = z.object({
  registry_name: z.enum(MCP_REGISTRIES),
  name: z.string(),
  version: z.string().optional(),
  package_arguments: z.array(z.string()).optional(),
  environment_variables: z.array(McpEnvironmentVariableSchema).optional(),
});
export type McpPackage = z.infer<typeof McpPackageSchema>;

export const McpRemoteSchema = z.object({
  transport_type: z.enum(MCP_TRANSPORTS),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type McpRemote = z.infer<typeof McpRemoteSchema>;

export const McpPayloadSchema = z
  .object({
    kind: z.literal("mcp"),
    packages: z.array(McpPackageSchema).nullable().optional(),
    remotes: z.array(McpRemoteSchema).nullable().optional(),
  })
  .refine(
    (data) => (data.packages && data.packages.length > 0) || (data.remotes && data.remotes.length > 0),
    { message: "An MCP payload must define at least one package or remote." },
  );
export type McpPayload = z.infer<typeof McpPayloadSchema>;

export const McpNameSchema = z.string().min(1);

/**
 * The full detail shape of an MCP Server resource.
 */
export const McpSchema = z.object({
  id: z.string(),
  kind: z.literal("mcp"),
  namespace: z.string(),
  name: McpNameSchema,
  description: z.string().max(MCP_DESCRIPTION_MAX_LENGTH),
  body: z.string().nullable(),
  packages: z.array(McpPackageSchema).nullable().optional(),
  remotes: z.array(McpRemoteSchema).nullable().optional(),
  source: z.string(),
  published_at: timestamp,
  updated_at: timestamp,
  published_by: PublisherSchema,
  tags: z.array(TagSchema),
  installs: z.number().int().nonnegative(),
});
export type McpDetail = z.infer<typeof McpSchema>;

/**
 * Payload sent by a publisher when creating or updating an MCP Server.
 */
export const McpPublishSchema = z
  .object({
    description: z.string().max(MCP_DESCRIPTION_MAX_LENGTH),
    body: z.string().nullable().optional(),
    packages: z.array(McpPackageSchema).optional(),
    remotes: z.array(McpRemoteSchema).optional(),
    source: z.string().optional(),
  })
  .refine(
    (data) => (data.packages && data.packages.length > 0) || (data.remotes && data.remotes.length > 0),
    { message: "An MCP publish request must define at least one package or remote." },
  );
export type McpPublish = z.infer<typeof McpPublishSchema>;

/**
 * Response returned by the single-phase MCP publish route.
 */
export const McpPublishedSchema = z.object({
  resource: McpSchema,
});
export type McpPublished = z.infer<typeof McpPublishedSchema>;
