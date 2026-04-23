---
tags:
  - claude-code
  - feature
  - torque-crm
  - comunicacao
created: 2026-04-12
last_updated: 2026-04-23
status: active
---

# Chat WhatsApp

## O que faz

Interface unificada de chat multi-canal (WhatsApp via Evolution API, Messenger e Instagram via Meta, SZ.Chat Alamaster). Usuarios recebem e enviam mensagens em todos os canais numa unica tela com lista de contatos, historico completo e envio de texto/midia.

## Regras de negocio

- Mensagens agrupadas por `contact_key` (phone para WhatsApp, sender_id para Meta)
- Unread tracking via localStorage (nao persistido no banco)
- Copilot pode responder automaticamente com batch de 8 segundos (agrupa msgs antes de responder)
- Human takeover pausa o bot por 10 minutos
- Mensagens de canais diferentes do mesmo lead aparecem separadas por contact_key
- Realtime subscription com debounce de 2 segundos

## Como o usuario usa

1. Abre Chat WhatsApp no menu lateral
2. Ve lista de contatos com badge de canal (WhatsApp/Messenger/Instagram)
3. Clica no contato → ve historico de mensagens
4. Digita mensagem ou anexa midia → envia
5. Pode ver detalhe do lead no painel lateral

## Edge cases

- Lead sem telefone nao aparece no chat
- Audio cross-browser precisa conversao OGG/WebM → MP3 (ver docs/AUDIO_CONVERSION_WEBHOOK.md)
- CORS de audio no Supabase Storage precisa config separada (ver docs/STORAGE_CORS.md)
- onUpdate do realtime recebe apenas campos alterados, nao row completo com joins

## Invariante — Idempotência `whatsapp_messages` (2026-04-20)

**Toda** escrita em `whatsapp_messages` em `supabase/functions/**` usa `upsert` com `onConflict: "message_id,instance_id"`. Zero `.insert()` brutos. UNIQUE `(message_id, instance_id)` existe desde `20260127000000_add_whatsapp_messages.sql:37`.

Por que: outbound-sender / workflow-action-handler / dispatchers gravam a linha ANTES do echo do Evolution chegar (com o mesmo `key.id`). Sem upsert idempotente, o echo criava duplicata ou precisava ser silenciado via `msgError.message.includes("duplicate")` (frágil, mascarava falhas reais).

**Política de `ignoreDuplicates`**:

| Contexto | Valor | Razão |
|---|---|---|
| Webhook echo handler (`evolution-webhook`, `sz-chat-webhook`) | `true` | Outbound/dispatcher é fonte de verdade para `content` humanizado + `sent_by_ai`. Echo não deve sobrescrever. |
| Dispatcher/sender (`outbound-sender`, `workflow-action-handler`, `followup-sender`, `ai-action-executor`, `campaign-rule-dispatch`, `pipe-rule-dispatch`, `process-scheduled-user-messages`) | `false` | Dispatcher escreve o state final — se alguma linha pré-existir, sobrescreve com o dado autoritativo. |
| **Exceção única**: `evolution-webhook` `send.message` handler (`SEND_MESSAGE_MEDIA_REFRESH` marker) | `false` | Precisa refrescar `media_url` com URL Storage-backed quando `MESSAGES_UPSERT` chegou antes com URL null/CDN expirada. |

**Contract test em CI**: `tests/unit/whatsapp-messages-idempotency-contract.test.ts` — 5 asserts AST-grep sobre `supabase/functions/**`:
1. Zero `.insert(` em `whatsapp_messages`.
2. Todo `.upsert(` tem `onConflict: "message_id,instance_id"`.
3. Webhook files = `ignoreDuplicates: true` (exceto `SEND_MESSAGE_MEDIA_REFRESH`).
4. Dispatcher files = `ignoreDuplicates: false`.
5. Nenhum arquivo que escreve `whatsapp_messages` swallows erro via `.includes("duplicate")`.

Qualquer PR que violar cai no CI.

---

## Como funciona (tecnico)

### Componentes

- `src/components/chat/WhatsAppChat.tsx` — UI principal do chat multi-canal
- `src/components/chat/ChannelBadge.tsx` — Badge visual do canal (WhatsApp/Messenger/Instagram)
- `src/components/chat/LeadDetailContent.tsx` — Detalhe do lead no contexto do chat

### Hooks

- `src/hooks/useChannelChat.ts`:
  - `useChannelContacts()` — queryKey: `["channel-contacts", orgId]`, tabela `channel_messages`, agrupa por contact_key, conta unread, merge metadata
  - `useChannelMessages(contactKey)` — mensagens de um contato especifico
  - `useSendChannelMessage()` — roteia para Evolution API (WhatsApp) ou send-meta-message (Meta)
  - `useChannelMessagesRealtime()` — realtime subscription em `channel_messages` com postgres_changes

### Edge Functions

- `evolution-api-proxy` — Proxy reverso para Evolution API (mantem API key server-side)
- `evolution-webhook` — Recebe eventos WhatsApp (CONNECTION_UPDATE, MESSAGES_UPSERT, MESSAGES_UPDATE)
- `sz-chat-webhook` / `sz-chat-send` — SZ.Chat Alamaster (recebe msgs, envia respostas)
- `send-meta-message` — Envia para Messenger/Instagram via Meta Graph API

### Tabelas

- `channel_messages` — Storage unificado (id, organization_id, channel, remote_jid, phone_number, sender_id, sender_name, direction, message_type, content, media_url, status, lead_id, timestamp)
- `whatsapp_instances` — Instancias Evolution API (instance_name, status, metadata com copilot_agent_id)
- `sz_chat_config` — Config SZ.Chat por org (api_url, api_token, channel_id, team_mappings)
- `meta_pages` — Paginas Meta conectadas (page_id, page_access_token, instagram_account_id)

### Fluxo de dados

```
Webhook externo (Evolution/Meta/SZ.Chat)
  → Edge function (valida, normaliza, linka com lead)
    → INSERT em channel_messages
      → Realtime subscription (postgres_changes)
        → React Query invalidate
          → UI atualiza lista de contatos e mensagens
```

---

## Historico de mudancas

### 2026-04-23 — Onda 6 final (Dark LOW pages closure)

- `src/pages/Privacidade.tsx` — full dark-ification (14 ocorrencias gray-* → semantic tokens)
- `src/pages/master/MasterFeatures.tsx` + `MasterAuditLogs.tsx` — badge fallback `bg-gray-500` → `bg-muted text-muted-foreground`
- `src/pages/master/MasterOperations.tsx` — skipped + engine badge fallback semantico
- `src/pages/AutomacoesExecucoes.tsx` — skipped status `text-gray-400` → `text-muted-foreground` (2 ocorrencias)
- `src/pages/PipeWhatsapp.tsx` — TikTok badge `bg-gray-900` → `bg-foreground text-background` (brand compliant), "Outros" fallback semantico
- `src/pages/CampanhaDetail.tsx` — manual campaign badge simplificado para semantic puro

Dark LOW pages: **100% limpo** (grep `gray-[0-9]+` em `src/pages/` → 0 matches).

Diferido para Onda 6.1: 13 componentes em `src/components/**` com 22 ocorrencias residuais. Ver `.specs/features/chat-onda-6/tasks.md` para lista exata.

Branch: `feat/chat-onda-6-final` (nao mergeada — PR manual pelo CTO).

## Links relacionados

- [[Mensagens Agendadas]]
- [[Templates de Mensagem]]
- [[WhatsApp Evolution]]
- [[SZ Chat]]
- [[Meta Facebook]]
- [[Copilot]]
