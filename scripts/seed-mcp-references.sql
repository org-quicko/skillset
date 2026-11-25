SET search_path TO in_org_quicko_sqillset;

-- Ensure 'mcp' tag exists
INSERT INTO tags (id, name, created_at, updated_at)
VALUES (gen_random_uuid(), 'mcp', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

-- 1. Filesystem Server
INSERT INTO resources (
  id, kind, namespace, name, description, body, payload, source,
  published_by, published_by_email, published_by_name,
  published_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'mcp',
  'io.github.modelcontextprotocol',
  'io.github.modelcontextprotocol/server-filesystem',
  'Secure local filesystem access server for Model Context Protocol.',
  '# Filesystem MCP Server

Provides configurable file read, write, and directory traversal capabilities for LLMs with explicit path boundary controls.

### Tools
- `read_file`: Read the complete contents of a file.
- `write_file`: Create or overwrite a file with given contents.
- `list_directory`: List entries in a directory.
- `directory_tree`: Recursive directory tree structure.
- `search_files`: Search for files matching a pattern.

### Installation
```bash
skillset install io.github.modelcontextprotocol/server-filesystem
```',
  '{
    "kind": "mcp",
    "packages": [
      {
        "registry_name": "npm",
        "name": "@modelcontextprotocol/server-filesystem",
        "version": "0.6.2",
        "package_arguments": ["/projects"]
      }
    ],
    "remotes": null
  }'::jsonb,
  'https://github.com/modelcontextprotocol/servers',
  '01a1e33c-a9a4-7ed8-bb65-6e2dc142524b',
  'dev.parikh@quicko.com',
  'Dev Parikh',
  NOW(), NOW(), NOW()
) ON CONFLICT (kind, namespace, name) DO UPDATE SET
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  payload = EXCLUDED.payload,
  updated_at = NOW();

-- 2. PostgreSQL Server
INSERT INTO resources (
  id, kind, namespace, name, description, body, payload, source,
  published_by, published_by_email, published_by_name,
  published_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'mcp',
  'io.github.modelcontextprotocol',
  'io.github.modelcontextprotocol/server-postgres',
  'Read-only database access server for PostgreSQL inspection and queries.',
  '# PostgreSQL MCP Server

Enables LLMs to inspect schema metadata, execute read-only SQL queries, and explore data relationships.

### Tools
- `query`: Execute read-only SQL queries.
- `list_tables`: List all tables in the connected database.
- `describe_table`: Show schema and column types for a specific table.

### Installation
```bash
skillset install io.github.modelcontextprotocol/server-postgres
```',
  '{
    "kind": "mcp",
    "packages": [
      {
        "registry_name": "npm",
        "name": "@modelcontextprotocol/server-postgres",
        "version": "0.6.2",
        "package_arguments": ["postgresql://localhost:5432/mydb"]
      }
    ],
    "remotes": null
  }'::jsonb,
  'https://github.com/modelcontextprotocol/servers',
  '01a1e33c-a9a4-7ed8-bb65-6e2dc142524b',
  'dev.parikh@quicko.com',
  'Dev Parikh',
  NOW(), NOW(), NOW()
) ON CONFLICT (kind, namespace, name) DO UPDATE SET
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  payload = EXCLUDED.payload,
  updated_at = NOW();

-- 3. GitHub Server
INSERT INTO resources (
  id, kind, namespace, name, description, body, payload, source,
  published_by, published_by_email, published_by_name,
  published_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'mcp',
  'io.github.modelcontextprotocol',
  'io.github.modelcontextprotocol/server-github',
  'Interact with GitHub repositories, issues, pull requests, and files.',
  '# GitHub MCP Server

Integrates GitHub repository management, file inspection, issues, and pull request workflows directly with your agent.

### Tools
- `create_or_update_file`: Commit changes to a branch.
- `search_repositories`: Find repositories by query.
- `get_issue` / `create_issue`: Manage GitHub issues.
- `create_pull_request`: Open a pull request.
- `list_commits`: View commit history.

### Installation
```bash
skillset install io.github.modelcontextprotocol/server-github
```',
  '{
    "kind": "mcp",
    "packages": [
      {
        "registry_name": "npm",
        "name": "@modelcontextprotocol/server-github",
        "version": "0.6.2",
        "environment_variables": [
          {
            "name": "GITHUB_PERSONAL_ACCESS_TOKEN",
            "description": "GitHub Personal Access Token (classic with repo scope or fine-grained)",
            "required": true
          }
        ]
      }
    ],
    "remotes": null
  }'::jsonb,
  'https://github.com/modelcontextprotocol/servers',
  '01a1e33c-a9a4-7ed8-bb65-6e2dc142524b',
  'dev.parikh@quicko.com',
  'Dev Parikh',
  NOW(), NOW(), NOW()
) ON CONFLICT (kind, namespace, name) DO UPDATE SET
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  payload = EXCLUDED.payload,
  updated_at = NOW();

-- 4. Fetch Server
INSERT INTO resources (
  id, kind, namespace, name, description, body, payload, source,
  published_by, published_by_email, published_by_name,
  published_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'mcp',
  'io.github.modelcontextprotocol',
  'io.github.modelcontextprotocol/server-fetch',
  'Web content fetching and HTML-to-Markdown conversion server.',
  '# Fetch MCP Server

Fetches web pages, extracts clean Markdown, and enables agents to browse online documentation and articles.

### Tools
- `fetch`: Fetch an HTTP/HTTPS URL and convert HTML contents into readable Markdown.

### Installation
```bash
skillset install io.github.modelcontextprotocol/server-fetch
```',
  '{
    "kind": "mcp",
    "packages": [
      {
        "registry_name": "pypi",
        "name": "mcp-server-fetch",
        "version": "0.6.2"
      }
    ],
    "remotes": null
  }'::jsonb,
  'https://github.com/modelcontextprotocol/servers',
  '01a1e33c-a9a4-7ed8-bb65-6e2dc142524b',
  'dev.parikh@quicko.com',
  'Dev Parikh',
  NOW(), NOW(), NOW()
) ON CONFLICT (kind, namespace, name) DO UPDATE SET
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  payload = EXCLUDED.payload,
  updated_at = NOW();

-- 5. Brave Search Server
INSERT INTO resources (
  id, kind, namespace, name, description, body, payload, source,
  published_by, published_by_email, published_by_name,
  published_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'mcp',
  'io.github.modelcontextprotocol',
  'io.github.modelcontextprotocol/server-brave-search',
  'Web and local search server powered by the Brave Search API.',
  '# Brave Search MCP Server

Enables LLMs to query the web and find local places/businesses using Brave Search API.

### Tools
- `brave_web_search`: Perform web searches with pagination and query operators.
- `brave_local_search`: Find local businesses and POIs.

### Installation
```bash
skillset install io.github.modelcontextprotocol/server-brave-search
```',
  '{
    "kind": "mcp",
    "packages": [
      {
        "registry_name": "npm",
        "name": "@modelcontextprotocol/server-brave-search",
        "version": "0.6.2",
        "environment_variables": [
          {
            "name": "BRAVE_API_KEY",
            "description": "Brave Search API Key",
            "required": true
          }
        ]
      }
    ],
    "remotes": null
  }'::jsonb,
  'https://github.com/modelcontextprotocol/servers',
  '01a1e33c-a9a4-7ed8-bb65-6e2dc142524b',
  'dev.parikh@quicko.com',
  'Dev Parikh',
  NOW(), NOW(), NOW()
) ON CONFLICT (kind, namespace, name) DO UPDATE SET
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  payload = EXCLUDED.payload,
  updated_at = NOW();

-- 6. Memory Server
INSERT INTO resources (
  id, kind, namespace, name, description, body, payload, source,
  published_by, published_by_email, published_by_name,
  published_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'mcp',
  'io.github.modelcontextprotocol',
  'io.github.modelcontextprotocol/server-memory',
  'Persistent knowledge-graph memory server for storing entities & relations.',
  '# Memory MCP Server

Maintains persistent knowledge-graph memory across agent sessions, enabling long-term personalization and context retention.

### Tools
- `create_entities`: Record new entities in the knowledge graph.
- `create_relations`: Link entities with semantic relations.
- `open_nodes`: Retrieve subgraph around specified nodes.
- `search_nodes`: Search graph entities and observations.

### Installation
```bash
skillset install io.github.modelcontextprotocol/server-memory
```',
  '{
    "kind": "mcp",
    "packages": [
      {
        "registry_name": "npm",
        "name": "@modelcontextprotocol/server-memory",
        "version": "0.6.2"
      }
    ],
    "remotes": null
  }'::jsonb,
  'https://github.com/modelcontextprotocol/servers',
  '01a1e33c-a9a4-7ed8-bb65-6e2dc142524b',
  'dev.parikh@quicko.com',
  'Dev Parikh',
  NOW(), NOW(), NOW()
) ON CONFLICT (kind, namespace, name) DO UPDATE SET
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  payload = EXCLUDED.payload,
  updated_at = NOW();

-- 7. Puppeteer Server
INSERT INTO resources (
  id, kind, namespace, name, description, body, payload, source,
  published_by, published_by_email, published_by_name,
  published_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'mcp',
  'io.github.modelcontextprotocol',
  'io.github.modelcontextprotocol/server-puppeteer',
  'Browser automation and interaction server powered by Puppeteer.',
  '# Puppeteer MCP Server

Enables LLMs to interact with web pages, take screenshots, click elements, fill forms, and evaluate JavaScript in a headless browser.

### Tools
- `puppeteer_navigate`: Go to a URL.
- `puppeteer_screenshot`: Take a screenshot of the page or an element.
- `puppeteer_click`: Click an element.
- `puppeteer_fill`: Type into an input field.
- `puppeteer_evaluate`: Evaluate JavaScript in browser context.

### Installation
```bash
skillset install io.github.modelcontextprotocol/server-puppeteer
```',
  '{
    "kind": "mcp",
    "packages": [
      {
        "registry_name": "npm",
        "name": "@modelcontextprotocol/server-puppeteer",
        "version": "0.6.2"
      }
    ],
    "remotes": null
  }'::jsonb,
  'https://github.com/modelcontextprotocol/servers',
  '01a1e33c-a9a4-7ed8-bb65-6e2dc142524b',
  'dev.parikh@quicko.com',
  'Dev Parikh',
  NOW(), NOW(), NOW()
) ON CONFLICT (kind, namespace, name) DO UPDATE SET
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  payload = EXCLUDED.payload,
  updated_at = NOW();

-- 8. Cloudflare Workers MCP Server (Remote SSE)
INSERT INTO resources (
  id, kind, namespace, name, description, body, payload, source,
  published_by, published_by_email, published_by_name,
  published_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'mcp',
  'com.cloudflare',
  'com.cloudflare/workers-mcp',
  'Remote SSE MCP server connecting to Cloudflare Workers and developer resources.',
  '# Cloudflare Workers MCP Server

A remote MCP server running over Server-Sent Events (SSE) that connects LLMs to Cloudflare Workers, KV namespaces, and D1 database instances.

### Transport
- **Type**: Server-Sent Events (SSE)
- **URL**: `https://mcp.cloudflare.com/sse`

### Installation
```bash
skillset install com.cloudflare/workers-mcp
```',
  '{
    "kind": "mcp",
    "packages": null,
    "remotes": [
      {
        "transport_type": "sse",
        "url": "https://mcp.cloudflare.com/sse",
        "headers": {
          "Authorization": "Bearer ${CLOUDFLARE_API_TOKEN}"
        }
      }
    ]
  }'::jsonb,
  'https://github.com/cloudflare/workers-mcp',
  '01a1e33c-a9a4-7ed8-bb65-6e2dc142524b',
  'dev.parikh@quicko.com',
  'Dev Parikh',
  NOW(), NOW(), NOW()
) ON CONFLICT (kind, namespace, name) DO UPDATE SET
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  payload = EXCLUDED.payload,
  updated_at = NOW();

-- Associate 'mcp' tag with all MCP resources
INSERT INTO resource_tags (resource_id, tag_id, created_at, updated_at)
SELECT r.id, t.id, NOW(), NOW()
FROM resources r
CROSS JOIN tags t
WHERE r.kind = 'mcp' AND t.name = 'mcp'
ON CONFLICT (resource_id, tag_id) DO NOTHING;

-- Refresh materialized view
REFRESH MATERIALIZED VIEW resource_analytics;
