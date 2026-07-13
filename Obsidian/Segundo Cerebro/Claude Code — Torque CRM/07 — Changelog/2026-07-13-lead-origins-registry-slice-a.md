---
data: 2026-07-13
tipo: changelog
área: leads
slice: A
status: dev (não-prod)
---

# 2026-07-13 — Origens de Lead: registry unificado + editar origem (Slice A)

## Contexto
`leads.origin` tinha 4 fontes dessincronizadas no frontend: a canônica
`analytics/useMktOriginConfig` (13), a stale `src/lib/lead/lead-origins.ts` (só 7,
usada no LeadCreateForm e LeadSource) e maps locais duplicados. Consequências:
o form de criar lead via chat não expunha Indicação/Evento/Prospecção/Instagram/Tiktok/Landing,
e a origem era **read-only** no drawer de detalhe V2 (o CTO "não conseguia editar a origem").

## Mudanças

- **DB**: nova tabela registry `lead_origins` (fonte única de lista/label/cor).
  `organization_id` nullable (NULL = built-in global; preenchido = custom da org no Slice B).
  RLS: built-ins legíveis por qualquer `authenticated`; custom via `get_my_organization_ids()`
  OR `is_master_user()`; `service_role` FOR ALL (não há BYPASSRLS no projeto). Sem policies
  de write para authenticated (custom CRUD = Slice B). Seed dos 13 built-ins espelhando
  `useMktOriginConfig`. Trigger `updated_at` dedicado (search_path pinado, não depende de
  helper global — há drift de `set_updated_at` entre ambientes).
- **Hook**: `useLeadOrigins()` (`src/modules/leads/hooks/useLeadOrigins.ts`, exportado no
  barrel). `{ origins, labelOf, colorOf, isLoading }`; fallback `BUILTIN_LEAD_ORIGINS` (13);
  org-custom sobrepõe built-in por slug (forward-compat).
- **Consolidação (leads)**: `LeadCreateForm`, `LeadModal`, `LeadSource` passam a ler a lista
  dinâmica. `src/lib/lead/lead-origins.ts` (stale) **deletada**.
- **Editar origem no drawer V2**: `info-field-config.ts` origin `type:"origin"` (era readOnly);
  `InfoBlockTracking` renderiza Select editável (`useLeadOrigins`), persiste via `useUpdateLead`
  (+ log de ação + invalida `["lead-detail", id]`/`["leads"]`). Badge de cor preservado
  (usa `ORIGIN_COLORS` do LeadCard — sem regressão visual).

## Arquivos tocados
- `supabase/migrations/20270313000000_lead_origins_registry.sql` — tabela + índices + RLS + seed
- `src/modules/leads/hooks/useLeadOrigins.ts` — hook novo
- `src/modules/leads/index.ts` — export do hook
- `src/modules/leads/components/lead/create/LeadCreateForm.tsx` — lista dinâmica
- `src/modules/leads/components/leads/LeadModal.tsx` — lista dinâmica (removeu map local)
- `src/modules/leads/components/lead/info/LeadSource.tsx` — `labelOf` dinâmico
- `src/modules/leads/components/lead-detail/modal/body/info-field-config.ts` — origin editável
- `src/modules/leads/components/lead-detail/modal/body/InfoBlockTracking.tsx` — Select de origem + persistência
- `src/integrations/supabase/types.ts` — tipo de `lead_origins` (inserido na forma do gerador; no-op no próximo regen pós-prod)
- `src/lib/lead/lead-origins.ts` — **deletado**
- `tests/unit/use-lead-origins.test.ts`, `tests/unit/lead-origins-ui.test.tsx` — testes

## Segurança
- Multi-tenant: RLS é o gate; custom nunca vaza cross-org (`get_my_organization_ids`).
  Built-ins (org_id NULL) só a `authenticated` (anon sem policy → negado; `REVOKE ... FROM anon`).
- `authenticated` reduzido a SELECT (Supabase default privileges concedia ALL; RLS já bloqueava,
  mas alinhamos o GRANT — defense-in-depth).
- service_role com policy FOR ALL explícita (sem BYPASSRLS neste projeto).

## Decisões
- Slice A é behavior-preserving no dado: **não** alterou o enum `lead_origin` nem webhooks.
- Color maps com shape próprio (bg/text pairs em LeadCard/kanban/analytics/marketing) mantidos
  **estáticos** (idênticos ao seed) para não regredir dashboards — migração dinâmica fica pro Slice B.
- `types.ts` recebeu o tipo de `lead_origins` manualmente (regen de dev é inseguro por drift;
  regen de prod ainda não tem a tabela). Fica idêntico ao gerador → diff zero no próximo regen.

## Follow-ups (Slice B)
- Enum `lead_origin` → text + CRUD de origens custom por org (policies write + UI settings) + webhooks.
- Migração dinâmica dos color maps estáticos restantes (LeadCard/kanban/analytics/marketing/useMktOriginConfig).
- Aplicar a migration em **prod** (`jsjsmuncfkbsbzqzqhfq`) — pendente, responsabilidade do arquiteto/CTO.

## Estado
Aplicado e verificado em **dev** (13 built-ins, RLS ativa, authenticated read-only, service_role write).
`npm run test:unit` (novos): 7/7 verdes. Não commitado (versionamento = arquiteto).
