---
tipo: changelog
data: 2026-07-02
área: campaigns
tags: [changelog, disparos, blast-plans, uazapi, failure-sync]
---

# Disparos — integração do sync de falha no poll + tab "Falha na entrega" (#948)

## Mudanças

- **mass-send-status**: depois de atualizar os agregados do job, o poll sincroniza falhas por lead — busca mensagens `Failed` do folder (`POST /sender/listmessages`, novo `senderListMessages` no `UazapiClient`, paginado 1000/página) e reclassifica `blast_plan_recipients` `sent → failed` com `reason` canônico via `syncFolderFailures` (runner novo em `_shared/quick-blast/failure-sync-runner.ts`, deps-injected, nunca lança). Cron 1/min ⇒ reclassificação em ≤2 ciclos, inclusive no poll final que conclui o job.
- **Drill-down Disparos**: tab "Falha na entrega" no `BlastPlanRecipientsSheet` com contador + motivo humano por lead (`failureReasonLabel`). Renderizada só com ≥1 `failed` (plano antigo sem provenance não mostra grupo Falha). Recipients `failed` saem de Enviados — grupos mutuamente exclusivos.
- **Card do plano**: `useBlastPlanProgress` ganhou bucket `failed`; card mostra "· N falhas" (destructive) e conta failed como processado na barra. `StepMonitor` do wizard idem.
- **Refetch**: `useBlastPlanRecipients` com `refetchInterval` 60s (cadence do cron) — lead migra de Enviados pra Falha no refresh seguinte ao sync.

## Arquivos tocados

- `supabase/functions/mass-send-status/index.ts` — wiring do sync pós-agregados (try/catch + logRuntime `failure_sync`; contrato 200 preservado)
- `supabase/functions/_shared/quick-blast/failure-sync-runner.ts` — **novo**: orquestração testável `syncFolderFailures(deps, jobRow)`
- `supabase/functions/_shared/quick-blast/failure-sync.ts` — `parseDispatchProvenance` exportado (gate antes do provider)
- `supabase/functions/_shared/uazapi-client.ts` — `senderListMessages(folderId, {messageStatus})`, paginação até esgotar
- `supabase/functions/_shared/uazapi-types.ts` — tipo `UazapiSenderMessage`
- `supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts` + `_shared/whatsapp-client.ts` — método exposto no provider/port (opcional — não-Uazapi = skip)
- `src/modules/campaigns/lib/blast-recipient-view.ts` — `failureReasonLabel` (pura)
- `src/modules/campaigns/components/BlastPlanRecipientsSheet.tsx` — tab Falha condicional + detail/cores
- `src/modules/campaigns/hooks/useBlastPlanRecipients.ts` — status union + `failed`, refetch 60s
- `src/modules/campaigns/hooks/useBlastPlans.ts` — `BlastPlanProgress.failed`
- `src/modules/campaigns/components/BlastPlanCard.tsx`, `components/disparo-wizard/StepMonitor.tsx` — failed como processado
- Testes: `tests/unit/blast-plan-failure-sync-runner.test.ts` (**novo**, 12 casos), `tests/unit/uazapi-client.test.ts` (+8), `tests/unit/uazapi-provider-sender.test.ts` (+1), `tests/unit/blast-recipient-view.test.ts` (+6)

## Decisões

- Tab Falha **oculta com count 0** (não zerada): grupo vazio permanente insinuaria tracking que não existe pra plano pré-ADR-0016. Documentado em [[06 — Features/Chat/disparos-falha-entrega]].
- Texto cru do erro do provider **não persiste** — só o reason canônico (schema só tem `reason`); o cru viaja no `FailedTransition.error` pra log/debug.
- Refetch por intervalo em vez de realtime: `blast_plan_recipients` não tem `organization_id` pro filtro do canal padrão de `useRealtimeSubscription`.

## Follow-ups

- Smoke test read-only de `/sender/listmessages` contra folder real da instância dev antes do deploy prod (caveat spike #943: evidência = spec OpenAPI, não chamada live).
- Migration `20270104000000_blast_plan_recipients_failed_status.sql` (slice #947) precisa estar aplicada antes do deploy da edge function.
