# Meta WhatsApp Cloud — Outbound Send (Track B final slice)

**Branch base:** `feat/meta-cloud-api` lineage · **Constraint:** zero Uazapi behavioral change
**Contract:** `docs/meta-cloud-cert/CERTIFICATION.md` (15 rules + §6 regression gate)
**Status:** implemented (DEV) — not deployed, not committed by engenheiro.

## O que é

Implementa o ENVIO real do 3º provider WhatsApp (Meta Cloud API / Graph). Até esta
slice, `MetaCloudProvider.sendText/sendMedia` lançavam `MetaNotImplementedError`
(skeleton da slice 1). Tudo ao redor já estava mergeado: credenciais
(`whatsapp_instance_secrets` + RPC `get_meta_cloud_credentials`), inbound
(`meta-webhook/processWhatsAppCloudEntry` → `whatsapp_messages`), status callbacks
(`applyCloudStatus`), templates (`meta_message_templates`), e o roteamento no factory.

## Arquivos

| Arquivo | Mudança |
|---|---|
| `supabase/functions/_shared/whatsapp-providers/meta-cloud-graph.ts` | **NOVO** — graph client thin + injetável (`createMetaCloudGraph`): sendText, sendMediaByLink/ById, sendTemplate, uploadMedia, getMedia, getPhoneNumber. Token só no header Bearer, nunca logado. `GRAPH_VERSION = v21.0` (mesmo dos clients de signup/template). |
| `supabase/functions/_shared/whatsapp-providers/meta-cloud-window.ts` | **NOVO** — `isSessionOpen(admin, instanceId, phone)`: lê última row `direction='incoming'` em `whatsapp_messages`, open = <24h. Sem row → CLOSED (fail-safe). Meta-only (Rule 6). |
| `supabase/functions/_shared/whatsapp-providers/meta-cloud-provider.ts` | sendText/sendMedia/sendTemplate/getStatus/setPresence(no-op)/downloadMedia REAIS. Orquestra creds (lazy/memoized/fail-closed) + janela + mapeamento wamid. Capability methods mantêm `NotSupportedError` "does not support" (Rule 7). |
| `supabase/functions/_shared/whatsapp-client.ts` | `SendTemplateOptions` + método opcional `sendTemplate?` na interface; `MetaWindowClosedError` (classe nova). |
| `supabase/functions/whatsapp-api-proxy/index.ts` | force-import de `meta-cloud-provider.ts` no eszip (Rule 15 / incidente REALSC dynamic-import). |
| `tests/unit/meta-cloud-{graph,window,provider-send}.test.ts` | **NOVOS** — 64 casos. |

## Decisões fechadas

### D4 — onde a outgoing row é persistida (CRÍTICO): **o provider NÃO persiste.**

Ambos os callers que conseguem alcançar uma instância `meta_cloud` já persistem a
row outgoing chaveada por `SendResult.message_id` (= wamid real):

1. **Composer humano** (chat UI → `whatsapp-api-proxy` → `provider.sendText`): os hooks
   `useSendWhatsAppMessage`/`useSendWhatsAppMedia`
   (`src/modules/communication/hooks/chat/useWhatsAppSend.ts`) fazem
   `whatsapp_messages.upsert({ message_id: result.message_id, ... }, { onConflict:
   "message_id,instance_id" })` — provider-agnóstico, funciona pra meta_cloud sem mudança.
2. **Auto-dispatch server-side** (`outbound-sender.ts` etc.) persiste chaveado pelo mesmo
   id — MAS é provider-blind-excluído de Meta (Rule 1: `resolveInstance` filtra
   `provider IN ('uazapi','evolution')`), então nunca chega no MetaCloudProvider.

Persistir no provider causaria **double-write**. Retornar o wamid real é suficiente:
`meta-webhook/applyCloudStatus` faz UPDATE por `(message_id, instance_id)` em
sent/delivered/read/failed e bate exatamente na row escrita pelo caller.

**Conclusão:** provider retorna `{ message_id: wamid, status: 'sent', timestamp }` e
não escreve em `whatsapp_messages`. Zero duplicata, zero stuck.

### MetaWindowClosedError vs NotSupportedError

Vive em `whatsapp-client.ts` (junto de `NotSupportedError`, o tipo cross-cutting).
NÃO é `NotSupportedError` — Meta SUPORTA o envio, mas fora da janela 24h exige
template. Mensagem clara exigindo template. Não colide com o matcher
`isFeatureUnavailable()` ("does not support").

### sendTemplate

Método opcional na interface (igual `sendMenu?`). Implementado só no MetaCloudProvider;
ausente em Uazapi/Evolution (callers feature-detectam). Ignora a janela 24h. POST
`/messages type:"template"` → retorna wamid.

### sendMedia (D5)

`file` URL http(s) → envia por `link`. base64 (ou data: URL) → `uploadMedia` multipart
→ media_id → envia por `id`. Tipo mapeado: image→image, video→video, audio/ptt→audio,
document→document, sticker→sticker. caption só image/video/document; filename só
document. Mesma checagem de janela do sendText.

## Critérios de aceite — verificados

1. ✅ Janela aberta: sendText envia free-form, retorna wamid real.
2. ✅ Janela fechada: sendText/sendMedia lançam `MetaWindowClosedError`.
3. ✅ sendTemplate ignora a janela, retorna wamid.
4. ✅ sendMedia: URL→link, base64→upload→id, tipo mapeado.
5. ✅ Credencial via `get_meta_cloud_credentials`; sem token/erro → throw fail-closed; token nunca logado (teste explícito).
6. ✅ message_id = wamid real; D4 documentada; zero double-write.
7. ✅ Uazapi/Evolution intactos; meta_cloud ainda "does not support" nos capability methods. Pinning §6 sem regressão nova.
8. ✅ setPresence('composing') no-op, não throw.
9. ✅ getStatus e downloadMedia funcionam (mock).

## QA (counts literais)

- `npm run lint` — **0 errors**, 2704 warnings pré-existentes (no-explicit-any).
- `npm run typecheck:ratchet` — 41 erros novos-vs-baseline **pré-existentes na branch** (baseline stale); minhas mudanças adicionam **0** (provado via stash diff).
- `npm run build` — **GREEN** (87 modules, built in ~280ms).
- `npm run test:unit` — **47 failed / 4655 passed / 150 skipped**. Mesmos 28 arquivos falhos do baseline capturado (`/tmp/baseline_fails.txt`), **0 novas falhas**. Passing subiu 4607→4655 (+novos testes meta-cloud).
- `npm run test:edge` — CI-only (Deno não roda local). Não executado.

## Follow-ups

- Wire `MetaCloudProvider.downloadMedia` no fluxo de mídia inbound do `meta-webhook`
  (hoje inbound grava só `media_url = media_id`; download destrava bytes mas ainda não
  é chamado automaticamente). Slice separada.
- Composer → UI de template fora-da-janela (catch `MetaWindowClosedError` → oferecer template). Fora de escopo desta slice.
