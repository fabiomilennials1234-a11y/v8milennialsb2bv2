# torque-mcp — internal MCP ops server (Edge Function)

MCP (Model Context Protocol) server over **Streamable HTTP**, for CTO + Claude subagents to
diagnose/recover CRM state through curated, audited tools. See
`docs/adr/0011-torque-mcp-internal-ops-server.md`.

## Security model — RLS-inherited

- Gated by an `x-mcp-secret` header (single guard, like `x-cron-secret`).
- The function signs in as a **dedicated ops-master** (`signInWithPassword`) and runs every query
  with that JWT → **RLS ON**, master-ghost policies grant cross-org. It **never** uses
  `service_role` for data.
- Read tools never call `SECURITY DEFINER` RPCs (they bypass RLS) — each does a direct RLS-on
  `SELECT`. Mutating tools (S2) MAY reuse a `SECURITY DEFINER` RPC that does its own permission
  check (e.g. `restore_lead`) — safer than granting the master broad write.

## Mutations (S2)

Hidden unless `TORQUE_MCP_ALLOW_MUTATIONS=true`. Every mutation: **dry-run by default** (returns the
`plan` + a `confirmToken` = `${exp}.${sha256(plan + exp)}`); applies only when the caller echoes
`confirm_token` back (forces the plan to be seen — no blind confirm) and only within the token's
**TTL window (~5 min)** — a stale token is rejected even if the plan is unchanged. The hash covers
both the plan and the expiry, so a tampered expiry fails the check. **Audit-first**: records to
`master_audit_logs` actor=mcp BEFORE applying — a failed audit aborts. `cron.toggle` is the one
privileged tool (`requiresServiceRole`, uses the `toggle_cron_job` SECURITY DEFINER RPC).

## Diagnostics — `db.read_sql` (S3)

Always visible (read-only) but **every query is audited** to `master_audit_logs`. Runs a single
caller-supplied `SELECT`/`WITH` through the `mcp_exec_readonly_sql` SECURITY DEFINER RPC, which
executes it **as a dedicated `mcp_readonly` role** inside a `READ ONLY` transaction with a statement
timeout. Containment is layered: master-only check, a parse guard (single statement, SELECT/WITH
only, no comments/DDL — mirrored on both edge and DB sides), the role has `SELECT` only and is
**revoked on secret/credential/token tables**, and the READ ONLY txn blocks writes at the engine
level. Migration: `20261226000000_torque_mcp_readonly_role.sql`.

## Hardening (S3)

- When `TORQUE_MCP_ALLOW_MUTATIONS=true`, config is **strict**: `SUPABASE_SERVICE_ROLE_KEY` must be
  present and `TORQUE_MCP_PROJECT` must be set explicitly to `dev`|`prod` (no silent default) — fail
  loud at boot rather than discover it at apply time.
- `initialize` returns `serverInfo.project` so every caller sees which environment it hit.
- Unhandled errors are reported to Sentry (`captureError`) while keeping the JSON-RPC envelope; each
  `tools/call` emits a PII-free structured log line (tool, outcome, ms).

### Rotating `x-mcp-secret`

`supabase secrets set --project-ref <ref> MCP_GATEWAY_SECRET=<new>` on **both** dev and prod, then
update the connected clients' `x-mcp-secret` header. The old secret stops working as soon as the new
one is set (single guard, no overlap window).

## Layout

```
index.ts            Deno.serve: CORS/OPTIONS + x-mcp-secret gate + JSON-RPC dispatch
lib/config.ts       env → Config (fail-loud on missing secrets; safe defaults)
lib/auth.ts         session freshness + isolate-cached master client provider
lib/clients.ts      signInAsMaster → RLS-scoped client
lib/dispatch.ts     MCP methods: initialize / tools/list (gated) / tools/call
lib/http.ts         x-mcp-secret compare + single/batch payload handling
lib/registry.ts     visibleTools (hides mutating tools when ALLOW_MUTATIONS off)
lib/guardrails.ts   runMutation — dry-run + echo-token confirm + audit-first
lib/crypto.ts       stableStringify + sha256hex (echo-token hashing)
lib/audit.ts        auditMcpAction → master_audit_logs (audit-first); re-exports redact
lib/redact.ts       PII redaction for audit
lib/types.ts        JSON-RPC + ToolDef types (ToolContext: db + optional serviceDb)
tools/lead.ts       lead.get + lead.restore
tools/trace.ts      lead.trace_history
tools/conversation.ts  conversation.get
tools/whatsapp.ts   whatsapp.instance_status
tools/blast.ts      blast.status
tools/copilot.ts    copilot.dump_prompt + copilot.update_prompt
tools/cron.ts       cron.toggle (requiresServiceRole)
tools/db.ts         db.read_sql (read-only role + READ ONLY txn, audited)
```

## Secrets (Supabase function env)

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are auto-injected by the platform. Set the rest:

```bash
supabase secrets set --project-ref bcfadphgsibjzivtbjvc \
  MCP_GATEWAY_SECRET=<random> \
  MCP_MASTER_EMAIL=mcp-ops@torquecrm.com.br \
  MCP_MASTER_PASSWORD=<password>
# optional: TORQUE_MCP_PROJECT=dev (default), TORQUE_MCP_ALLOW_MUTATIONS=false (default)
# when ALLOW_MUTATIONS=true (required): SUPABASE_SERVICE_ROLE_KEY=<key> + TORQUE_MCP_PROJECT=dev|prod
```

Prereqs: create the `mcp-ops` user and mark it master (`master_users`); apply migrations
`20261222000000_torque_mcp_master_ghost_policies.sql` (S1),
`20261223000000_torque_mcp_s2_policies.sql` (S2: copilot UPDATE policy + `toggle_cron_job` RPC), and
`20261226000000_torque_mcp_readonly_role.sql` (S3: `mcp_readonly` role + `mcp_exec_readonly_sql`).

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
