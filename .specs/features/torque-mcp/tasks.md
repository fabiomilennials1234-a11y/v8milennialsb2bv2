# Tasks: Torque MCP (Edge Function, RLS-herdado)

**Branch:** `feat/torque-mcp/s1` · **ADR:** `docs/adr/0011` · **Atualizado:** 2026-06-22

Design = Edge Function MCP / Streamable HTTP / RLS-herdado (ver ADR 0011). Build vertical (tracer-first), TDD red-green nas partes puras; DB/HTTP verificado no CI (Q3: `edge-function-tests` + `integration-tests`).

## S1 — espinha + read pack

### Feito ✅ (38 unit tests Deno verde, lint 0, index type-check ok)
- [x] **Espinha de protocolo** (lib/): `config` (env/secrets, defaults seguros), `guardrails` (dry-run/confirm/audit), `redact` (PII), `registry` (gating mutations), `dispatch` (initialize+negociação / tools/list gated / tools/call / notifications), `auth` (freshness + provider master cacheado), `http` (gate constant-time + payload single/batch), `clients` (signInAsMaster → RLS-scoped), `types`
- [x] **`lead.get`** (tracer) — id|phone (phone via RPC `normalize_brazilian_phone`), pipes embed, anti-bypass (NÃO usa `api_get_lead` SECURITY DEFINER) + testes puros
- [x] **`index.ts`** — Deno.serve + CORS/OPTIONS + gate + dispatch; `config.toml` `[functions.torque-mcp] verify_jwt=false`; `deno.json` import map `@supabase/supabase-js`
- [x] **Migration** `20261222000000_torque_mcp_master_ghost_policies.sql` — master-ghost SELECT p/ as 5 tabelas que faltavam (whatsapp_conversation_summary, uazapi_sender_jobs, blast_plans, blast_plan_recipients, blast_daily_usage); as outras já tinham (verificado no diagnose)
- [x] **Teste-âncora RLS** `tests/integration/torque-mcp-rls.test.ts` (CI) — master cross-org em leads + pipeline_entries + blast_daily_usage; non-master scoped
- [x] **Diagnose** (2026-06-22) — protocolVersion negocia (fix); migration trimada (drift); service_role false-positive descartado

### Feito ✅ (cont.) — read pack completo (50 unit tests verde, lint 0, index type-check ok)
- [x] `lead.trace_history` — `mergeTimeline` (pura) + handler 4 fontes (lead_history + deleted_leads_log + pipeline_entries + audit_log)
- [x] `conversation.get` — `threadSummary` (pura, awaiting_reply) + handler (rpc normalize → whatsapp_messages + resolve lead)
- [x] `whatsapp.instance_status` — `instanceHealth` (pura, is_dead/dead_for_minutes) + handler (whatsapp_instances; nunca lê secrets)
- [x] `blast.status` — `blastSelector` + `flagStuck` (puras; encoda o bug queued+sender_id null) + handler (uazapi_sender_jobs single/list)
- [x] `copilot.dump_prompt` — `extractPromptSources` (pura; parseia os 3 lugares) + handler (copilot_agents)
- [x] 6 tools registradas em `index.ts` (`TOOLS`)

### Falta ⏳
- [ ] **Deploy prereqs (mão do CTO / dev):** criar user `mcp-ops` + marcar master (`master_users`); `supabase secrets set` (MCP_GATEWAY_SECRET / MCP_MASTER_EMAIL / MCP_MASTER_PASSWORD); aplicar migration em dev; `supabase functions deploy torque-mcp`; ligar MCP no Claude (README)
- [ ] Verde no CI (integration + edge) após push
- [ ] (opcional) Integração por-tool no CI — hoje o teste-âncora cobre a propriedade RLS-herdada (generaliza); queries das tools individuais verificam em runtime/deploy

## S2+ — mutating pack (depois, atrás de `TORQUE_MCP_ALLOW_MUTATIONS`)
- [ ] `blast.requeue`, `lead.restore`, `cron.toggle`, `copilot.update_prompt` (3 lugares + prompt_hash=NULL) — dry-run/confirm/audit (runMutation já pronto)
- [ ] `audit()` helper DB (grava `audit_log` actor=`mcp`, audit-first) + master-ghost FOR ALL onde a mutação exigir
- [ ] `db.read_sql` (role read-only dedicada), `rls.check_access`, `migration.diff_prod`

## Fora de escopo
Cenário B (customer-facing); HTTP remoto stateful; auto-gen de tools. Ver ADR 0011.
