# Inventário de features — Torque CRM (2026-07-02)

Fontes: `src/App.tsx` (rotas), `TopNavigation.tsx` + `MobileBottomNav.tsx`, `src/modules/*/pages/`, 14 sub-CLAUDE.md. Base do gating: `feature-registry.ts` + seeds de `subscription_plans`.

## CRM core (Base+)

| Feature | Rota(s) | Módulo | Feature key |
|---|---|---|---|
| Central de Comando (dashboard) | `/dashboard` | analytics | analytics |
| Funis (hub) | `/funis` | pipelines | funnels |
| Pipe WhatsApp / Confirmação / Propostas | `/pipe-whatsapp`, `/pipe-confirmacao`, `/pipe-propostas` | pipelines | funnels |
| Pipeline customizado | `/pipe/custom/:slug` | pipelines | funnels_custom |
| Negócios (deals) | `/negocios` | pipelines | deals |
| Leads ("Combustível") | `/leads` | leads | leads |
| Lixeira / Duplicatas | `/lixeira`, `/duplicatas` | leads | leads |
| Follow-ups (Revisão) | `/follow-ups` | engagement | review |
| Checklists | `/checklists` | engagement | — |
| Agenda | `/agenda` | engagement | — |
| Ranking / Performance | `/performance` (5 rotas legadas redirecionam) | analytics+engagement | performance |
| Comissões | `/comissoes` | engagement | commissions |
| TV Dashboard | `/tv` | analytics | tv_dashboard |
| Produtos | `/produtos` | carteira | products |
| Carteira / Upsell | `/upsell`, `/carteira/:clientId` | carteira | carteira, customer_portfolio |
| Lead forms / UTM | (marketing) | marketing | marketing |

## Chat (Automation+)

| Feature | Rota(s) | Módulo | Feature key |
|---|---|---|---|
| Chat WhatsApp (inbox) | `/chat`, `/chat-whatsapp` | communication | chat |
| Atendimento Meta (Messenger/IG) | `/atendimento/meta` | communication | chat |
| Message Templates | `/templates` | communication | message_templates |

## Automações (Automation+)

| Feature | Rota(s) | Módulo | Feature key |
|---|---|---|---|
| Automações (workflows DAG) | `/automacoes`, `/automacoes/novo`, `/automacoes/:id`, `/:id/execucoes` | workflows | automations |
| Campanhas | `/campanhas/:id` | campaigns | campaigns_* (legadas) |
| Disparos em massa | `/disparos` | campaigns | whatsapp_bulk |
| Mensagens agendadas | (in-chat) | communication | scheduled_messages |

## Copilot/IA (só Copilot; addon turbo p/ Base/Automation)

| Feature | Rota(s) | Módulo | Feature key |
|---|---|---|---|
| Copilot (agentes IA) | `/copilot`, `/copilot/metricas`, `/copilot/novo`, `/copilot/:id/editar` | copilot | copilot, copilot_advanced |
| Oráculo (briefing IA no dashboard) | (embed em `/dashboard`) | analytics/copilot | oraculo |

## Plataforma/Admin (todos os planos)

Equipe `/equipe` (identity) · Configurações `/configuracoes` (platform) · Onboarding Hub `/onboarding` (platform, adminOnly) · Privacidade `/privacidade` (público) · Landing/Auth/Reset (marketing/identity) · Command palette ⌘K (platform, global).

## Master-only (interno, fora de plano)

`/master/*` (14 telas: organizations, users, plans, features, audit-logs, operations, automation-health, whatsapp-health, copilot-reasoning, copilot-toggle-audit, onboarding, meta-assets) + `/insights` (unit economics). Guard `MasterRoute`; master bypassa gates de plano via `plan_name === "master"`.

## Notas de gating

- 3 camadas: role/permissão (`PermissionProtectedRoute`) → plano (`PlanFeatureProtectedRoute` + cadeado nav) → org type outbound (subset de paths).
- Admin bypassa permissão, NÃO bypassa plano. Master bypassa tudo.
- `merged_opportunity_funnel` = rollout flag per-org, não é feature de plano.
- Páginas órfãs (sem rota) e código morto: ver PLAN.md Fase 1.
