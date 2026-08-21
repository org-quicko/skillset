# No Agent Skills Discovery Protocol

`vercel-labs/skills` defines a discovery protocol — `GET /.well-known/agent-skills/index.json`
with `$schema: https://schemas.agentskills.io/discovery/0.2.0/schema.json` — and any server
that serves it is installable by `npx skills add <url>` into roughly 70 agents. We are not
serving it, because that CLI sends `Authorization: Bearer` only on GitHub API calls:
discovery and artifact downloads are plain `fetch`, so serving the index would mean
publishing every Skill to anyone who can reach the host.

## Consequences

Reads stay token-gated and all Registry auth remains ours. The cost is real and worth being
honest about: no third-party agent can install from this Registry, and `skillreg` is the
only client, so every consumption path is code we maintain.

This is deferred rather than rejected on principle. If the Registry ever sits behind a
trusted network perimeter instead of relying on Tokens, serving the index is roughly an
afternoon — it is a projection of the `skills` table — and it would buy back those clients.
