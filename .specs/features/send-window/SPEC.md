# Janela de envio automático (quiet-hours por org)

**Origem:** feedback Sorvfoods (2026-07-14), problema #1 dos 6.
**Status:** implementado — branch `feat/auto-send-window-guard`.

## Problema

Automações (copilot outbound, workflow, campanha, disparo) enviavam texto e
**áudio** para leads entre 2h e 3h da madrugada. Cliente B2B que recebe áudio de
automação de madrugada denuncia/bloqueia — dano de reputação de chip + marca. Não
havia nenhum guard global de horário: os 4 sistemas de janela existentes
(`behavior_windows` do copilot — só prompt; `wait_business_window` de workflow;
business-hours de followup; quiet-hours de blast) são locais e opcionais.

## Decisão (CTO ausente → julgamento world-class, reversível)

1. **Adiar, não descartar.** Fora da janela o envio é reagendado p/ a próxima
   abertura. Nada se perde (lead que manda msg 2h é respondido 8h).
2. **Default ON conservador** 08:00–21:00, todos os dias, para TODAS as orgs.
   Opt-out por org via `auto_send_window_enabled=false`. Mata a madrugada em toda
   a base já no `ADD COLUMN`.
3. **Todos os paths automáticos** cobertos por um guard único.
4. **Envio manual de humano NUNCA é bloqueado** (guard só atua sobre trackSource
   automático).

## Arquitetura

Não existe chokepoint único de envio (2 camadas de entrada + mass bypass).
Estratégia em 2 níveis:

- **Defer (reschedule)** onde o reagendamento é natural: **copilot outbound**
  (`_shared/outbound-sender.ts` → `sendOutboundDispatch`). Fora da janela seta
  `outbound_dispatch_log.scheduled_at = nextValidAt` mantendo `status='pending'`;
  o cron `process-outbound-dispatches` (drena `pending AND scheduled_at<=NOW`)
  reenvia na abertura. Cobre texto + áudio (o culpado reportado).
- **Backstop (block + log)** nas camadas por onde passam os demais automáticos:
  wrappers de `_shared/whatsapp-dispatch.ts`
  (`sendText/Audio/Media/Menu/PixButtonViaInstance`) e
  `_shared/message-gateway.ts` (`sendMessage`). Fora da janela retornam resultado
  bloqueado (`send_window_blocked`) sem enviar. Garante que nenhum path legado
  (workflow action, campaign/pipe/mass dispatch) vaze de madrugada mesmo sem
  reschedule dedicado.

### Guard util — `_shared/send-window.ts`

- `isAutomaticSource(trackSource)` — match por prefixo
  (copilot/workflow/campaign/pipe/mass/followup/reactivation/outbound). `manual`,
  ausente ou desconhecido → false (liberado).
- `loadOrgSendWindow(supabase, orgId)` — lê colunas + `organizations.timezone`
  (reusa fuso canônico). Cache 30s. **Fail-open**: erro/coluna ausente → liberado
  (não bloqueia envio por falha transitória de leitura).
- `evaluateSendWindow(win, now)` — puro. Reusa `nextValidSendTime` de
  `quick-blast/quiet-hours.ts` (convenção de dias 0=Dom…6=Sáb, janela meio-aberta
  `[from, to)`) e `buildDateInTimezone` de `copilot/time-context.ts` p/ voltar o
  wall-clock local → `Date` UTC de reagendamento.
- `guardAutomaticSend(...)` — conveniência (classifica + carrega + decide).

## Schema — migration `20270316000000_org_auto_send_window.sql`

Colunas em `organizations`:

| coluna | tipo | default |
|---|---|---|
| `auto_send_window_enabled` | boolean NOT NULL | `true` |
| `auto_send_window_from_minutes` | smallint NOT NULL | `480` (08:00) |
| `auto_send_window_to_minutes` | smallint NOT NULL | `1260` (21:00) |
| `auto_send_window_days` | smallint[] NOT NULL | `{0..6}` |

CHECK: minutos ∈ [0,1440], `from < to`, dias ⊆ {0..6}. Reusa
`organizations.timezone`. Nenhuma função/grant nova; colunas herdam RLS de
`organizations` (UPDATE liberado a admin — precedente `auto_create_lead_on_inbound`).

## UI

`src/modules/platform/components/settings/SendWindowSettings.tsx`, montado em
`Configuracoes.tsx` (aba Geral). Switch de ativação + horário início/fim + toggles
de dias. Persiste via UPDATE em `organizations`. Resiliente a coluna ausente.

## Testes

`tests/unit/send-window.test.ts` — 16 casos: classificação de fonte,
dentro/antes-abertura/depois-fecho/fecho-exato/dia-excluído, disabled, sem-dia,
mapeamento do loader, fail-open (erro + null), guard manual bypass e
copilot-outbound madrugada/dentro. Fuso America/Sao_Paulo (UTC-3).

## Cobertura & follow-ups

- ✅ copilot outbound (defer), workflow/campaign/pipe/mass legado + gateway (block).
- ⏳ **Defer real p/ workflow** (setar `next_run_at` no executor) — hoje é block.
  Melhoria futura: transformar backstop de block→defer onde houver contexto de
  reschedule. Não bloqueia o objetivo (madrugada já não sai).
- ⏳ Followup já tem business-hours próprio; org-window é backstop redundante.
- Mass send via `runUazapiSenderJob` (`/sender/advanced`) tem scheduling próprio
  do Uazapi + quiet-hours de blast — fora do backstop dos wrappers; validar.

## Deploy

- Migration: aplicar manual (dev → prod) via processo padrão.
- Edge functions a redeployar (consomem `_shared` alterado): `outbound-trigger`,
  `process-outbound-dispatches`, `process-workflow-executions`,
  `campaign-rule-dispatch`, `pipe-rule-dispatch`, `process-pipe-distribution`,
  `semi-automatic-dispatch`, `carteira-bulk-message` e demais que importam
  `whatsapp-dispatch`/`message-gateway`/`outbound-sender`.
- Frontend: auto-deploy no merge em main (EasyPanel).
