# 2026-06-18 — Meta WhatsApp Cloud: Outbound Send (Track B final)

## Mudanças
- **communication / WhatsApp**: 3º provider (Meta Cloud API) agora ENVIA. `MetaCloudProvider.sendText/sendMedia/sendTemplate/getStatus/setPresence/downloadMedia` reais — saem do skeleton (`MetaNotImplementedError`).
- **Janela 24h**: guard isolado Meta-only (`meta-cloud-window.ts`). Uazapi free-form intacto (Rule 6).
- **Graph client**: `meta-cloud-graph.ts` thin + injetável; token nunca logado; `GRAPH_VERSION=v21.0`.

## Arquivos tocados
- `supabase/functions/_shared/whatsapp-providers/meta-cloud-graph.ts` — **NOVO** graph client (sendText/media/template/upload/getMedia/getPhoneNumber).
- `supabase/functions/_shared/whatsapp-providers/meta-cloud-window.ts` — **NOVO** `isSessionOpen` (24h, fail-safe closed).
- `supabase/functions/_shared/whatsapp-providers/meta-cloud-provider.ts` — implementações reais + orquestração creds/janela/wamid.
- `supabase/functions/_shared/whatsapp-client.ts` — `SendTemplateOptions`, `sendTemplate?` opcional, `MetaWindowClosedError`.
- `supabase/functions/whatsapp-api-proxy/index.ts` — force-import meta provider no eszip (Rule 15).
- `tests/unit/meta-cloud-{graph,window,provider-send}.test.ts` — **NOVOS** (64 casos).

## Decisões
- **D4 — provider NÃO persiste a outgoing row.** Composer humano (`useWhatsAppSend.ts`) e auto-dispatch (`outbound-sender.ts`) já fazem upsert em `whatsapp_messages` chaveado por `message_id = wamid`. Persistir no provider = double-write. Provider retorna só o wamid real; `meta-webhook/applyCloudStatus` casa o status por `(message_id, instance_id)`. Detalhe: `.specs/features/meta-cloud-outbound/SPEC.md`.
- `MetaWindowClosedError` ≠ `NotSupportedError` (Meta suporta o envio; fora da janela exige template). Vive em `whatsapp-client.ts`.

## QA
- lint: 0 errors / 2704 warnings pré-existentes.
- build: GREEN.
- typecheck:ratchet: 0 erros novos das minhas mudanças (41 pré-existentes na branch — baseline stale, provado via stash diff).
- test:unit: 47 failed / 4655 passed / 150 skipped — mesmos 28 arquivos do baseline, **0 novas falhas**.
- test:edge: CI-only (Deno), não rodado local.

## Follow-ups
- Chamar `downloadMedia` no inbound de mídia do `meta-webhook` (hoje grava só `media_url=media_id`).
- Composer: UI de template fora-da-janela (catch `MetaWindowClosedError`).
- Deploy prod (edge fns) + commit/push = pendente (arquiteto/CTO).
