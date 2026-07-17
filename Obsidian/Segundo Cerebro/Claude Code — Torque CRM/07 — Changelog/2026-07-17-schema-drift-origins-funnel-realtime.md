---
type: changelog
title: 2026-07-17 — Hotfix drift código↔schema — lead_origins.label, funnel order_index, realtime org filter
status: shipped-partial
created: 2026-07-17
updated: 2026-07-17
tags: [incident, schema-drift, lead-origins, funnel-conversion, realtime, multi-tenancy, hotfix]
related: ["[[project_lead_origins_registry]]"]
owner: gabriel
---

# 2026-07-17 — Hotfix drift código↔schema (incidente prod)

## Contexto

Incidente prod ativo: código deployado (`origin/main`) referenciava colunas que
não existem mais no schema de prod (`jsjsmuncfkbsbzqzqhfq`). Gerava ~7.264 erros
Postgres/24h e degradava o Realtime (pool timeout). Três bugs independentes.

Trabalho isolado em worktree de `origin/main` (branch
`fix/lead-origins-funnel-schema-drift`) — a branch de trabalho corrente estava
71 commits atrás e contaminada. Sem commit/push (fechamento pelo arquiteto).

## Bug 1 (dominante) — `useLeadOrigins` pedia coluna inexistente `lead_origins.label`

A tabela `lead_origins` em prod tem `name`, não `label`. O hook consultava
`.select("slug,label,color,sort_order,organization_id")` e ordenava por `label`
→ **todo render de lead** disparava `column lead_origins.label does not exist`.

**Fix** (`src/modules/leads/hooks/useLeadOrigins.ts`): `.select` e `.order`
passam a usar `name`; o hook mapeia `name`→`label` internamente ao montar o
shape. **API pública 100% preservada** (`LeadOriginOption.label`, `labelOf`,
`colorOf`, `UseLeadOriginsResult`) — consumidores (`LeadSource`, `LeadModal`,
`LeadCreateForm`, `InfoBlockTracking`, `NewLeadsBlock`, barrel) intocados. O
merge por slug (built-in org_id NULL + custom da org) e o fallback local
`BUILTIN_LEAD_ORIGINS` ficaram idênticos. `types.ts` já expunha `name` (regen
desnecessário). **Multi-tenant OK**: RLS de `lead_origins` continua o gate;
merge por slug não vaza custom de outra org.

> ⚠️ O erro `lead_origins.label` só para de aparecer **após redeploy do frontend
> (EasyPanel)** — o bundle antigo continua rodando até o pull. Passo manual do CTO.

## Bug 2 — `get_funnel_conversion` usava `ps.order_index` (coluna virou `position`)

`pipeline_stages` em prod só tem `position`. A fn `public.get_funnel_conversion`
referenciava `ps.order_index` em 5 pontos → funil de conversão 100% quebrado.

**Fix**: migration forward-fix
`supabase/migrations/20270717000000_fix_get_funnel_conversion_order_index_to_position.sql`
— `CREATE OR REPLACE` idêntica ao snapshot ADR-0018 (`20270301000000`), trocando
`ps.order_index`→`ps.position` em SELECT/GROUP BY/LAG/ORDER BY. Assinatura,
`SECURITY DEFINER`, `search_path`, alias de retorno `stage_order` e a checagem de
org via `team_members` preservados. **APLICADA EM PROD via MCP** (autorizado).
Verificado: `get_funnel_conversion('whatsapp')` roda sem erro; `pg_get_functiondef`
não contém mais `order_index` e usa `ps.position`.

## Bug 3 (colateral) — subscrição realtime filtrava `organization_id` em tabela sem a coluna

Erro `invalid column for filter organization_id`. 8 tabelas na publication
`supabase_realtime` não têm `organization_id`. Quatro assinaturas frontend
mandavam o filtro inválido e derrubavam o canal:

- `useCampanhas.ts` → `campanha_leads`
- `useUpsellClientProducts.ts` → `upsell_client_products`
- `useLeadScore.ts` → `lead_scores`
- `useLeadDetailRealtime.ts` → `pipe_proposta_items` (via `useRealtimeChannel` direto, `filter: orgFilter`)

**Fix**:
- `src/shared/realtime/useRealtimeSubscription.ts` — adicionadas ao allowlist
  `TABLES_WITHOUT_ORG_ID` as 7 tabelas columnless da publication (`acoes_do_dia`,
  `campanha_leads`, `feature_permissions`, `lead_scores`, `pipe_proposta_items`,
  `support_ticket_comments`, `upsell_client_products`). Assinam sem filtro; RLS
  (`apply_rls` no realtime) gate os eventos por org e a invalidação por queryKey
  re-busca com escopo no servidor. Fix central + future-proof.
- `src/modules/leads/components/lead-detail/hooks/useLeadDetailRealtime.ts` —
  `pipe_proposta_items` passa `filter: undefined` (removido `orgFilter` órfão).

**Multi-tenant OK**: RLS habilitada nas 8 tabelas (verificado em prod). Sem filtro
no transporte, o realtime ainda só entrega eventos que o usuário pode SELECT.

## Arquivos tocados

- `src/modules/leads/hooks/useLeadOrigins.ts` — `name`→`label` interno
- `src/modules/leads/hooks/useLeadOrigins.test.ts` — novo (5 casos: coluna `name`, mapeamento, override por slug, fallback, degradação)
- `src/shared/realtime/useRealtimeSubscription.ts` — 7 tabelas columnless no allowlist
- `src/modules/leads/components/lead-detail/hooks/useLeadDetailRealtime.ts` — remove filtro org de `pipe_proposta_items`
- `src/modules/leads/components/lead-detail/hooks/__tests__/useLeadDetailRealtime.test.ts` — assertion atualizada (filtro agora `undefined`)
- `supabase/migrations/20270717000000_fix_get_funnel_conversion_order_index_to_position.sql` — novo, **aplicado em prod**

## Verificação

- `npx vitest run` nos arquivos tocados: 11 passed (5 origins + 6 lead-detail-realtime)
- `npx eslint` nos 4 arquivos de código: 0 errors
- `npx tsc --noEmit`: sem erros nos arquivos tocados
- Prod MCP: `get_funnel_conversion` roda sem erro, `order_index` some do corpo

## Follow-ups

- 🔴 **CTO — redeploy frontend (EasyPanel)** para o Bug 1 e Bug 3 pararem em prod
  (bundle antigo ainda serve `lead_origins.label` + filtro inválido). Bug 2 já
  resolvido em prod (só banco).
- Merge da branch `fix/lead-origins-funnel-schema-drift` (arquiteto).
- Origem raiz do drift: schema evoluiu (`label`→`name`, `order_index`→`position`)
  sem sweep dos consumidores. Considerar CI que valide `.select()`/RPCs contra o
  schema gerado.
