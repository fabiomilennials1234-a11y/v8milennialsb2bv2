---
type: changelog
title: "2026-07-02 — plan-tiers-cleanup: faxina de código morto"
status: shipped
created: 2026-07-02
updated: 2026-07-02
tags: [changelog, plans, plan-tiers-cleanup]
related: []
owner: claude-agent
---

# 2026-07-02 — plan-tiers-cleanup: faxina de código morto

Fase 1 do projeto **plan-tiers-cleanup** (branch `feat/plan-tiers-cleanup`, stacked sobre `feat/plan-feature-gating`). Sweep de código morto verificado em 2026-07-02.

## Deletado (zero importers, verificado por grep + tsc + build)

| Artefato | Motivo |
|---|---|
| `src/modules/analytics/components/performance/CompetitionPodium.tsx` | Pódio v1, zero imports desde slice 12 |
| `src/modules/carteira/components/proposal/ProposalDetailModal.tsx` | `@deprecated`, nunca importado |
| `src/modules/campaigns/pages/Campanhas.tsx` | Lazy decl em App.tsx nunca renderizado (rota `/campanhas` é redirect pra `/funis`) |
| `src/modules/engagement/pages/{Metas,Ranking,Premiacoes,GestaoMetas}.tsx` | Órfãs desde slice 11 — rotas redirecionam pra `/performance` (decisão "reativar vs deletar" resolvida: deletar) |
| `src/modules/platform/pages/Onboarding.tsx` | Page legada — OnboardingGate/OnboardingHub substituíram |
| `src/modules/communication/components/whatsapp-migration/WhatsAppMigrationBanner.tsx` | Exportado no barrel, nunca montado |
| `supabase/functions/webhook-validate-url/` (+ entrada config.toml) | Zero call-sites (UI valida URL client-side) |
| `scripts/recovery/` (102 arquivos untracked) | Movidos pra `~/Desktop/torque-ops-archive-recovery` + gitignored |

## Mantido (falsos-positivos confirmados)

- `DashboardOutbound.tsx` — VIVO (renderizado por `Dashboard.tsx:89` quando org outbound)
- `campaigns/pages/MassSend.tsx` — órfã por decisão ("mantida pra futuro")
- `ClientDetailModal.tsx` — tag `@deprecated` era INCORRETA (usado por `UpsellBaseList`); tag removida
- `webhook-send-test` — VIVO (usado por `WebhookSettings.tsx:197`); nota "deletar candidato" corrigida nos CLAUDE.md
- `process-followup-situations` (ADR-0006, rollout pendente) e `recover-stuck-conversations` (ops manual) — documentados no mapa de edge functions
- Evolution provider + RepairingWizard, Copilot v2, SZ.Chat, hooks/components `legacy/` de pipelines — intocáveis (kill-switch/inert de propósito/ativos)

## Notas do vault ajustadas

- `06 — Features/modularizacao/auditoria-duplicatas.md` — linhas de `webhook-send-test` (era "DELETAR", está vivo), `webhook-validate-url` (deletada), `ProposalDetailModal` e `Premiacoes` marcadas como resolvidas
- Nenhuma nota do vault era 100% sobre artefato deletado — zero deleções de nota

Fase 2 (matriz de planos + enforcement server-side) segue no mesmo branch — ver `.specs/features/plan-tiers-cleanup/PLAN.md`.
