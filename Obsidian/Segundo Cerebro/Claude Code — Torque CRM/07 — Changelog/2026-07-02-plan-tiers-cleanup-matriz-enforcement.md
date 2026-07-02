# 2026-07-02 — plan-tiers-cleanup: matriz de planos + enforcement fechado

Fases 2–4 do projeto (branch `feat/plan-tiers-cleanup`). Fase 1 (faxina): ver nota do mesmo dia.

## Dados (migrations aplicadas em DEV; PROD aguarda ordem do CTO)

- `20270105000000` — **max_users: 5** nos 3 planos torque (era -1; trigger de seats estava desarmado pelo dado) + carteira/customer_portfolio/marketing seedados + re-sync `org_quotas` (22 rows) com audit trail.
- `20270105000001` — 🔴 bug pré-existente: **`deals` nunca foi seedado** (nem plano, nem feature_flags) → `hasFeature('deals')=false` universal → "Negócios" cadeado pra todas as orgs desde o plan-feature-gating. Fix: flag row + deals/review explícitos.

## Enforcement server-side (NOVO — antes era zero)

`_shared/plan-gate.ts` (`assertPlanFeature`, fail-closed) aplicado em 5 edges: agent-message (copilot, 200 skipped), oraculo-comercial (oraculo, 403), process-workflow-executions (automations, `skipped_plan` por execução), mass-send-create (whatsapp_bulk, 403), whatsapp-api-proxy (chat, 403, master bypassa). Detalhe: `docs/PERMISSION-ENFORCEMENT.md` § "Plan Gating Server-Side".

Seat check de `create-org-user` corrigido: lia `limits.users` (key inexistente — no-op silencioso desde sempre); agora `_shared/seat-quota.ts` sobre `org_resolve_quota`.

## Frontend

- `ROUTE_FEATURE_MAP` (fonte única) + 13 guards de rota novos — URL direta deixou de contornar o cadeado da nav. Teste de consistência nav↔rota (`route-feature-map.test.ts`).
- `PlanFeatureProtectedRoute` estrito: espera `isReady` (era fail-open no loading — janela de acesso a rota bloqueada).

## Grandfathering (dev)

5 orgs >5 ativos (todas torque-v8): Organização Principal (33), Alamaster (33), VitrineVET (23), Milennials (11), Basic4u (6). Trigger só bloqueia ADICIONAR; ninguém desativado. Lista de prod: levantar no apply.

## Referência

Matriz completa + mapa de camadas: `03 — Reference/Planos e Feature Gating.md`.
