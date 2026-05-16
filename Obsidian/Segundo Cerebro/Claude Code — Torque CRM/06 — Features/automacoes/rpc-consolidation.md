---
type: feature
title: Automações — RPC Consolidation + Health Check
status: active
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---



# Automações — RPC Consolidation + Health Check

## TL;DR

Automações pararam de funcionar intermitentemente porque migrations sucessivas RE-CRIARAM versões regredidas de `claim_workflow_executions` e `fire_workflow_trigger`, deixando overloads coexistindo em prod. PostgREST escolhia a versão errada (regredida) por ambiguidade de assinatura. Race condition + per-org starvation + chain-depth bypass + wait_response stuck — tudo simultâneo.

## Por que duas overloads coexistiam

PostgreSQL permite múltiplas overloads de uma função com mesmo nome e assinaturas distintas. Quando uma migration usa `CREATE OR REPLACE FUNCTION f(a int)` mas o DB já tem `f(a int, b int)`, o `OR REPLACE` só substitui se a assinatura bater **exatamente**. Caso contrário, cria nova overload.

`drop_legacy_rpc_overloads` (20260426000005) dropou as versões antigas, mas migrations posteriores (20260802, 20260818, 20260901) RECRIARAM versões com assinatura diferente da hardenizada — sem chain_depth, sem per_org_cap, sem race-fix.

Quando PostgREST recebe `.rpc(name, { batch_size: 20 })`, ele resolve por nomes de chave. Com 1 chave, escolhe a função 1-arg (mais específica). Edge function ficava chamando a regressão.

## Solução

Migration `20261001000000_consolidate_workflow_rpcs.sql`:
- DROP **todas** as overloads existentes
- CREATE única versão por RPC, com defaults nos parâmetros pra retrocompat
- Bloco final `DO $verify$` falha a migration se overload duplicada persistir (anti-regressão futura)

Plus:
- `pgnet_response_cleanup` daily — evita queue stuck
- `cron-health-check` edge function a cada 5min — detecta CRON_SECRET drift
- `resolve_wait_response_by_phone` — chamado pelos WhatsApp webhooks ao receber inbound (resolve workflows em waiting_response)

## Arquivos criados

- `supabase/migrations/20261001000000_consolidate_workflow_rpcs.sql`
- `supabase/migrations/20261001000001_pgnet_cleanup_cron.sql`
- `supabase/migrations/20261001000002_resolve_wait_response_by_phone.sql`
- `supabase/migrations/20261001000003_schedule_cron_health_check.sql`
- `supabase/functions/cron-health-check/index.ts`
- `supabase/functions/cron-health-check/health-check.ts` (pura, testável)
- `tests/integration/claim-workflow-executions.test.ts`
- `tests/integration/fire-workflow-trigger-chain-depth.test.ts`
- `tests/integration/resolve-wait-response-by-phone.test.ts`
- `tests/unit/cron-health-check.test.ts`
- `.specs/features/automacoes-rpc-consolidation/spec.md`
- `.specs/features/automacoes-rpc-consolidation/migration-plan.md`

## Arquivos editados

- `supabase/functions/whatsapp-webhook/index.ts` — fire-and-forget `resolve_wait_response_by_phone` em inbound
- `supabase/functions/sz-chat-webhook/index.ts` — paridade
- `supabase/config.toml` — registra `cron-health-check` com `verify_jwt=false`

## Anti-regressão

A própria migration 20261001000000 inclui:

```sql
DO $verify$
DECLARE
  v_dup_count int;
BEGIN
  SELECT count(*) INTO v_dup_count FROM (
    SELECT proname FROM pg_proc
    WHERE proname IN ('claim_workflow_executions', 'fire_workflow_trigger')
      AND pronamespace = 'public'::regnamespace
    GROUP BY proname HAVING count(*) > 1
  ) dups;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Consolidation failed: duplicate overloads remain';
  END IF;
END $verify$;
```

Se qualquer migration futura recriar uma overload regredida, este bloco falha a próxima aplicação dessa migration (ou re-aplicação da consolidation) e força revisão.

## Links

- Spec: `.specs/features/automacoes-rpc-consolidation/spec.md`
- Plano migração: `.specs/features/automacoes-rpc-consolidation/migration-plan.md`
- Changelog: `07 — Changelog/2026-05-12.md`
