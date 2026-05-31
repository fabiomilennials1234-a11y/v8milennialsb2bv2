---
type: changelog
title: Migration — Copilot v2 Foundation (prod apply)
date: 2026-05-31
tags: [changelog, migration, prod, copilot-v2]
related: ["[[ADR-0002]]", "[[aplicar-migration-prod]]"]
---

# Copilot v2 Foundation — apply em prod

## Deploy
- **PROD apply:** 2026-05-31 ~17:49 UTC (autorizado por Gabriel na sessão; aplicado via Supabase MCP `apply_migration`)
- **Projeto:** `jsjsmuncfkbsbzqzqhfq` (Torque CRM | PRODUÇÃO)
- **schema_migrations version:** `20260531174908` (name `copilot_v2_foundation`)
- **Arquivo local:** `supabase/migrations/20260531174908_copilot_v2_foundation.sql`

## Por que via MCP (não `db push`)
History de prod drifted: `db push` recusou ("remote migration versions not found in local") e teria arrastado 11 migrations locais pendentes não relacionadas (incl. timestamp malformado `20260985000000`). MCP `apply_migration` rodou **só** este SQL, isolado, e registrou no history. Migration é idempotente + aditiva (só `CREATE` de objetos `copilot_v2_*`, zero `ALTER`/`DROP`).

## O que criou
9 tabelas (`copilot_v2_agents`, `_config`, `_message_queue`, `_dlq`, `_dedup_locks`, `_pause_state`, `_turn_counters`, `_traces`, `_trace_steps`) + 5 RPCs SECURITY DEFINER (`acquire_dedup_lock`, `enqueue_message`, `check/set_human_pause`, `next_turn`). RLS deny-all default; 3 tabelas com read org-scoped via `get_my_organization_ids()`; 6 internas service-role only.

## Verificação (em prod)
- dedup race: 2 acquires mesma key → `true`, `false` ✅
- turn race: 3 `next_turn` → `1, 2, 3` (atômico) ✅
- pause phone-keyed: set + check pela canônica → `true` ✅
- `get_advisors security`: só 6 INFO `rls_enabled_no_policy` nas tabelas internas (deny-all intencional); zero ERROR/WARN ✅
- types regenerados → `src/integrations/supabase/types.ts`

## Rollback
Aditiva isolada — revert = `DROP TABLE copilot_v2_* CASCADE` + `DROP FUNCTION copilot_v2_*` (nada lê essas tabelas ainda fora do runtime v2 em construção).
