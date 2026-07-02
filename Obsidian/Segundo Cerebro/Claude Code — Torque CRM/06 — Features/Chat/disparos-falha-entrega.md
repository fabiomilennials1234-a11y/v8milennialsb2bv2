---
type: feature
title: Disparos — Falha na Entrega por Lead
status: active
created: 2026-07-02
updated: 2026-07-02
tags: [disparos, blast-plans, whatsapp, uazapi, feature]
related: [ADR-0016]
owner: gabriel
---

# Disparos — Falha na Entrega por Lead

## O que é

Rastreamento por lead das falhas reais de entrega de um Blast Plan (número inválido, número desconectado, rejeição do WhatsApp). Fecha a pergunta do operador "quais leads falharam?" — antes só existia o agregado `failed` do folder Uazapi. ADR-0016 (`docs/adr/0016-blast-recipient-delivery-failure-tracking.md`), PRD #941, slices #943 (spike), #944 (drill-down), #945 (provenance), #947 (core), #948 (integração + UI).

## Como funciona

1. **Dispatch** (`supabase/functions/_shared/dispatch-router.ts`): `runUazapiSenderJob` grava a provenance `{plan_id, lot_index}` no `uazapi_sender_jobs.payload` quando o job nasce de um Blast Plan.
2. **Poll** (`supabase/functions/mass-send-status/index.ts`, cron 1/min sobre jobs `queued|running`): depois de atualizar os agregados do job, chama `syncRecipientFailures` → `syncFolderFailures` (`_shared/quick-blast/failure-sync-runner.ts`).
3. **Runner**: gate na provenance (sem provenance = folder legado/avulso → zero chamadas ao provider) → busca mensagens `Failed` do folder via `senderListMessages` (`_shared/uazapi-client.ts`, `POST /sender/listmessages`, paginado 1000/página, filtro server-side `messageStatus: "Failed"`) → busca recipients `sent` do plan/lote → `computeFailedTransitions` (`_shared/quick-blast/failure-sync.ts`, core puro: match por telefone normalizado dentro do folder) → UPDATE `blast_plan_recipients` `status='failed'`, `reason` = código canônico.
4. **UI** (`src/modules/campaigns/components/BlastPlanRecipientsSheet.tsx`): tab "Falha na entrega" com contador + motivo humano por lead (`failureReasonLabel` em `src/modules/campaigns/lib/blast-recipient-view.ts`). Card do plano (`BlastPlanCard.tsx`) mostra "· N falhas" em destructive e conta failed como processado na barra.

## Regras de negócio

- `sent` é **otimista**: significa "aceito pela fila de envio", não "chegou no WhatsApp do lead" (ADR-0016 §4). O poll pode reclassificar `sent → failed` minutos depois — o lead migra de Enviados pra Falha entre refreshes.
- Reasons canônicos (classificação heurística do texto livre do provider, spike #943): `invalid_number` → "Número inválido", `instance_disconnected` → "Número desconectado", `provider_rejected` → "Rejeitado pelo WhatsApp", `provider_error` (e desconhecidos) → "Erro no envio". **Só o reason canônico persiste** — o texto cru do provider não vai pro schema (só existe a coluna `reason`).
- Grupos mutuamente exclusivos: Enviados / Falha / Pulados / Aguardando particionam a audiência congelada; a soma dos 4 = total do plano.
- **Tab Falha só renderiza com ≥1 `failed`**: plano antigo (sem provenance — sem retrofit heurístico, ADR-0016) ou plano saudável não ganha grupo vazio que insinuaria tracking inexistente. `failed` nunca regride, então a tab nunca some debaixo do usuário — só pode aparecer.
- Latência: cron roda 1/min e o sync roda dentro do próprio refresh do job (inclusive no poll final que conclui o job) → falha reportada pelo provider reclassifica em ≤2 ciclos.
- Falha no sync **nunca** quebra o refresh do job: runner nunca lança (resultado `{synced, error?}`), wrapper loga via `logRuntime` (`module: mass-send-status`, `action: failure_sync`).
- Idempotente: só recipients `sent` são candidatos (`status='sent'` no SELECT e no guard do UPDATE) — re-poll do mesmo folder não reescreve.

## Edge cases

- Provider sem `senderListMessages` (não-Uazapi): skip silencioso (`provider_unsupported`).
- Job sem `uazapi_sender_id`: skip (`no_folder_id`).
- Lead excluído do CRM (`lead_id` NULL, FK SET NULL): fica fora do sync — o core enderaça transições por `lead_id`; a linha permanece `sent` no histórico.
- Falha reportada pelo provider **depois** do job ir terminal não é capturada (cron para de pollar terminal) — na prática não ocorre: folder `done` implica mensagens em estado final, e o sync roda no tick que conclui o job.
- `/sender/listmessages` tem drift doc↔servidor documentado: client devolve array raw e nunca lança em envelope estranho; parsing defensivo fica no core.

## Áreas frágeis

- WhatsApp/Uazapi (adapter + endpoints `/sender/*`). Smoke test read-only contra folder real da instância dev recomendado antes do deploy prod (caveat do spike #943 — evidência é a spec OpenAPI, não chamada live).
- UI: refetch do sheet a cada 60s (`useBlastPlanRecipients`) — sem realtime porque `blast_plan_recipients` não tem `organization_id` pro filtro do canal padrão.

## Histórico

- 2026-07-02 — Integração do sync no poll + tab "Falha na entrega" (#948). Core (#947), provenance (#945), drill-down (#944) nas slices irmãs.
