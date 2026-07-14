---
data: 2026-07-14
tipo: feature
área: communication
origem: feedback Sorvfoods (#1 de 6)
branch: feat/auto-send-window-guard
---

# Janela de envio automático (quiet-hours por org)

## Contexto

Feedback Sorvfoods: automações mandavam texto e **áudio** para leads 2h-3h da
madrugada. Cliente B2B denuncia/bloqueia — queima reputação de chip e marca.
Nenhum guard global de horário existia; os 4 sistemas de janela do produto
(behavior_windows do copilot, wait_business_window, business-hours de followup,
quiet-hours de blast) são locais e opcionais.

## O que mudou

Guard único de janela de envio **automático** por org. Fora da janela, o envio é
**adiado** para a próxima abertura (não descartado). Envio **manual** de humano
nunca é afetado.

- **Default ON conservador** 08:00–21:00, todos os dias, TODAS as orgs (opt-out
  por org). Mata a madrugada na base inteira já no `ADD COLUMN`.
- **Copilot outbound** = defer real (reagenda `outbound_dispatch_log.scheduled_at`,
  cron re-drena). Cobre texto + áudio (culpado reportado).
- **Backstop block+log** nos wrappers de `whatsapp-dispatch` + `message-gateway`
  (workflow/campanha/pipe/mass legado).

## Arquivos

- `supabase/migrations/20270316000000_org_auto_send_window.sql` — 4 colunas em
  `organizations` + CHECKs. Reusa `organizations.timezone`.
- `supabase/functions/_shared/send-window.ts` — guard (math puro reusa
  `quick-blast/quiet-hours.ts`; TZ via `copilot/time-context.ts`).
- `_shared/outbound-sender.ts`, `_shared/whatsapp-dispatch.ts`,
  `_shared/message-gateway.ts` — pontos de enforcement.
- `src/modules/platform/components/settings/SendWindowSettings.tsx` + mount em
  `Configuracoes.tsx` (aba Geral).
- `tests/unit/send-window.test.ts` — 16 casos, verdes.
- Spec: `.specs/features/send-window/SPEC.md`.

## Pendente

- Aplicar migration (dev → prod) + redeploy das edge fns que importam o `_shared`
  alterado (outbound-trigger, process-outbound-dispatches,
  process-workflow-executions, campaign-rule-dispatch, pipe-rule-dispatch,
  semi-automatic-dispatch, carteira-bulk-message, ...).
- Follow-up: transformar backstop de workflow de block→defer (setar `next_run_at`).
- Validar mass send via `runUazapiSenderJob` (scheduling próprio do Uazapi).

## Refs

- É o problema **#1** dos 6 do feedback Sorvfoods. Faltam #2 inbox por vendedor +
  round-robin, #3 assinatura vendedor, #4 import base, #5 nome interno vs exibição,
  #6 grupos WhatsApp.
