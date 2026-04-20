---
tags:
  - claude-code
  - feature
  - torque-crm
  - comunicacao
created: 2026-04-12
last_updated: 2026-04-20
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

### 2026-04-20 — Fix layout "chat cortando" (vertical + horizontal)

Chat sofria corte vertical (composer empurrado fora da dobra) e horizontal (conteudo clipado na direita). 3 defeitos simultaneos:

1. **Vertical (primario)** — [WhatsAppChat.tsx:2327](../../../../src/components/chat/WhatsAppChat.tsx) usava `h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)]`. TopNav e `h-14` (3.5rem = 56px, nao 4rem). Alem disso, ignorava `py-6 lg:py-8` do [MainLayout.tsx:13](../../../../src/components/layout/MainLayout.tsx) (48-64px). Chat ficava 56-72px mais alto que o container, overflow do `<main>` era acionado e o composer sumia abaixo da dobra.

2. **Horizontal (secundario)** — [WhatsAppChat.tsx:2367](../../../../src/components/chat/WhatsAppChat.tsx) (Chat Window flex child) nao tinha `min-w-0`. `min-width: auto` default deixava filhos com `min-w-[200px]` (composer) ou texto sem quebra forcarem largura maior que a fatia flex. Como o container pai (2327) tem `overflow-hidden`, a sobra era clipada.

3. **Causa habilitadora** — `MainLayout` nao propagava altura pela cadeia flex. Wrapper interno era bloco sem flex/min-h-0, por isso o chat recorreu a math de viewport hardcoded (sintoma, nao solucao).

**Correcao** (3 arquivos, 6 linhas):

- `MainLayout.tsx`: `min-h-screen` → `h-screen`; `main` ganha `min-h-0` (permite flex-1 encolher abaixo do conteudo intrinseco); wrapper interno ganha `min-h-full flex flex-col` (propaga altura, short pages ainda preenchem, long pages rolam via main.overflow-auto).
- `WhatsAppChat.tsx:2327`: remove `h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)]`. Altura agora vem do chain flex (h-screen → main → flex-col wrapper → flex-1 page → flex-1 chat).
- `WhatsAppChat.tsx:2367`: adiciona `min-w-0` ao Chat Window.

**Robustez**: zero math de viewport no chat. Altura e largura seguem o layout pai — se TopNav ou padding mudarem, chat se ajusta automaticamente. `100dvh` implicito via `h-screen` herdado.

**Risco residual**: MainLayout agora bounded (h-screen). Antes a janela inteira rolava em paginas longas; agora o `<main>` rola, TopNav pinado. Comportamento visual quase identico (TopNav ja era `sticky top-0`). Verificado: `window.scroll` listener so no `LandingNavbar` (fora do MainLayout).

**Followups (mesmo bug em outras paginas)**:
- [CopilotPlayground.tsx:435](../../../../src/components/copilot/playground/CopilotPlayground.tsx) `h-[calc(100vh-4rem)]`
- [Agenda.tsx:1069](../../../../src/pages/Agenda.tsx) `h-[calc(100vh-4rem)]`
- [AutomacoesEditor.tsx:299](../../../../src/pages/AutomacoesEditor.tsx) `h-[calc(100vh-64px)] -m-6` (com hack para neutralizar padding do MainLayout)

Essas paginas beneficiam automaticamente da nova cadeia flex do MainLayout, mas ainda carregam hardcodes — trocar por `flex-1 min-h-0 h-full` quando tocar nelas.

## Links relacionados

- [[Mensagens Agendadas]]
- [[Templates de Mensagem]]
- [[WhatsApp Evolution]]
- [[SZ Chat]]
- [[Meta Facebook]]
- [[Copilot]]
