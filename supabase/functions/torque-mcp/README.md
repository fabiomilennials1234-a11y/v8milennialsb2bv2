# torque-mcp — internal MCP ops server (Edge Function)

MCP (Model Context Protocol) server over **Streamable HTTP**, for CTO + Claude subagents to
diagnose/recover CRM state through curated, audited tools. See
`docs/adr/0011-torque-mcp-internal-ops-server.md`.

## Security model — RLS-inherited

- Gated by an `x-mcp-secret` header (single guard, like `x-cron-secret`).
- The function signs in as a **dedicated ops-master** (`signInWithPassword`) and runs every query
  with that JWT → **RLS ON**, master-ghost policies grant cross-org. It **never** uses
  `service_role` for data.
- Tools never call `SECURITY DEFINER` RPCs (they bypass RLS) — each does a direct RLS-on `SELECT`.

## Layout

```
index.ts            Deno.serve: CORS/OPTIONS + x-mcp-secret gate + JSON-RPC dispatch
lib/config.ts       env → Config (fail-loud on missing secrets; safe defaults)
lib/auth.ts         session freshness + isolate-cached master client provider
lib/clients.ts      signInAsMaster → RLS-scoped client
lib/dispatch.ts     MCP methods: initialize / tools/list (gated) / tools/call
lib/http.ts         x-mcp-secret compare + single/batch payload handling
lib/registry.ts     visibleTools (hides mutating tools when ALLOW_MUTATIONS off)
lib/guardrails.ts   runMutation (dry-run/confirm/audit) — for the future mutating pack
lib/redact.ts       PII redaction for audit
lib/types.ts        JSON-RPC + ToolDef types
tools/lead.ts       lead.get (read pack tracer)
```

## Secrets (Supabase function env)

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are auto-injected by the platform. Set the rest:

```bash
supabase secrets set --project-ref bcfadphgsibjzivtbjvc \
  MCP_GATEWAY_SECRET=<random> \
  MCP_MASTER_EMAIL=mcp-ops@torquecrm.com.br \
  MCP_MASTER_PASSWORD=<password>
# optional: TORQUE_MCP_PROJECT=dev (default), TORQUE_MCP_ALLOW_MUTATIONS=false (default)
```

Prereqs: create the `mcp-ops` user and mark it master (`master_users`); apply migration
`20261222000000_torque_mcp_master_ghost_policies.sql`.

## Deploy

```bash
supabase functions deploy torque-mcp --project-ref bcfadphgsibjzivtbjvc   # dev
```

`config.toml` already declares `verify_jwt = false` (auth is the in-function gate).

## Connect from Claude (remote MCP)

```json
{
  "type": "http",
  "url": "https://bcfadphgsibjzivtbjvc.supabase.co/functions/v1/torque-mcp",
  "headers": { "x-mcp-secret": "<MCP_GATEWAY_SECRET>" }
}
```

## Tests

```bash
cd supabase/functions && deno task test       # pure logic (no Docker) — CI: edge-function-tests
npm run test:integration                       # RLS anchor (needs Supabase) — CI: integration-tests
```

`tests/integration/torque-mcp-rls.test.ts` proves the RLS-inherited property + the master-ghost
migration.
