---
tags:
  - torque-crm
  - docs
  - reference
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/meta-integration-design.md
---

# Design: Integracao Nativa Facebook/Instagram (Meta)

**Data**: 2026-03-07
**Status**: Aprovado para implementacao

---

## Understanding Summary

- **O que**: Integracao nativa com Meta para messaging (Messenger + Instagram Direct) e Lead Ads (captura automatica de leads de formularios de anuncios)
- **Por que**: Centralizar todos os canais de comunicacao num unico chat, sem ferramentas externas. Capturar leads de anuncios automaticamente
- **Para quem**: Usuarios do sistema (empresas B2B) que ja usam WhatsApp e querem adicionar Facebook/Instagram
- **Conexao**: Botao "Conectar com Facebook" nas configuracoes da organizacao, OAuth do Meta, conecta todas as paginas/contas automaticamente
- **Chat unificado**: Mensagens de Messenger e Instagram Direct no mesmo chat do WhatsApp, com badge de canal na foto do contato
- **Lead Ads**: Leads de formularios caem automaticamente (origin='meta_ads'), acoes pos-captura configuraveis pelo usuario
- **App proprio**: Facebook App da plataforma (Millennials), usuarios so autorizam
- **Copilot**: Nao atua nos novos canais por enquanto (futuro)

## Non-Goals

- Copilot nos novos canais (futuro)
- Conversions API (futuro)
- Cada usuario trazer seu proprio App
- Selecao individual de paginas/contas (conecta tudo)

## Assumptions

- Volume moderado (<1000 msgs/dia por conta conectada)
- Evolution API nao e usada para Meta - Graph API diretamente
- Reutilizamos estrutura de whatsapp_messages como base
- Supabase suporta volume adicional sem ajustes
- Comecamos em modo dev (5 contas teste), revisao Meta depois
- Tokens com refresh automatico + criptografia
- Mesma politica de retencao e soft-delete do WhatsApp
- Webhook: realtime + polling fallback 20s

---

## Decision Log

| # | Decisao | Alternativas | Motivo |
|---|---------|-------------|--------|
| 1 | Messaging + Lead Ads juntos | So messaging, so Lead Ads, incluir Conversions API | Usuario quer ambos desde o inicio |
| 2 | Chat unificado com badge de canal | Paginas separadas, abas/filtros | UX mais fluida, badge resolve identificacao |
| 3 | Lead criado auto, acoes configuraveis | Auto-disparo fixo, so notificacao | Flexibilidade pro usuario |
| 4 | Conexao nas configuracoes da org | Junto com WhatsApp, pagina separada | Organizacao logica |
| 5 | Copilot nao atua nos novos canais | Copilot em todos, configuravel | Simplifica escopo inicial |
| 6 | App proprio da plataforma | Cada usuario traz seu App | Mais simples pro usuario |
| 7 | Conecta tudo automaticamente | Selecao individual | Menos friccao, is_active desativa depois |
| 8 | Tabela unificada channel_messages | Tabelas separadas, hibrida com VIEW | Escala melhor, menos duplicacao |
| 9 | Tokens com refresh auto + criptografia | Refresh manual | Seguranca e UX |
| 10 | Modo dev primeiro, revisao depois | Submeter revisao antes | Permite dev e teste imediato |

---

## Design Final

### 1. Banco de Dados

#### Tabela `channel_messages` (substitui `whatsapp_messages`)

```sql
CREATE TYPE channel_type AS ENUM ('whatsapp', 'instagram', 'messenger');

CREATE TABLE channel_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  instance_id UUID REFERENCES whatsapp_instances(id),  -- null para Meta
  page_id TEXT,  -- Meta page_id, null para WhatsApp
  channel channel_type NOT NULL DEFAULT 'whatsapp',
  external_id TEXT NOT NULL,  -- message_id da plataforma
  phone_number TEXT,  -- normalizado, para WhatsApp e match com leads
  sender_id TEXT,  -- PSID (Messenger) ou IGSID (Instagram)
  sender_name TEXT,
  sender_profile_pic TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type TEXT NOT NULL DEFAULT 'text',  -- text, image, audio, video, document, sticker
  content TEXT,
  media_url TEXT,
  status TEXT DEFAULT 'sent',  -- sent, delivered, read, failed
  lead_id UUID REFERENCES leads(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(external_id, channel, organization_id)
);

CREATE INDEX idx_channel_messages_org_channel ON channel_messages(organization_id, channel);
CREATE INDEX idx_channel_messages_phone ON channel_messages(phone_number);
CREATE INDEX idx_channel_messages_sender ON channel_messages(sender_id);
CREATE INDEX idx_channel_messages_lead ON channel_messages(lead_id);
CREATE INDEX idx_channel_messages_created ON channel_messages(created_at DESC);
CREATE INDEX idx_channel_messages_conversation ON channel_messages(organization_id, phone_number, channel, created_at DESC);
```

#### Tabela `meta_connections`

```sql
CREATE TABLE meta_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  facebook_user_id TEXT NOT NULL,
  facebook_user_name TEXT,
  access_token TEXT NOT NULL,  -- long-lived user token (encrypted)
  token_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'expired', 'disconnected')),
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, facebook_user_id)
);
```

#### Tabela `meta_pages`

```sql
CREATE TABLE meta_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_connection_id UUID NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_access_token TEXT NOT NULL,  -- page-level token (encrypted)
  instagram_account_id TEXT,  -- null se pagina nao tem Instagram Business
  instagram_username TEXT,
  is_active BOOLEAN DEFAULT true,
  webhook_subscribed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, page_id)
);
```

#### Atualizacao do enum lead_origin

```sql
-- Adicionar 'instagram' e 'messenger' ao enum existente
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'messenger';
```

#### Migracao whatsapp_messages -> channel_messages

```sql
INSERT INTO channel_messages (
  organization_id, instance_id, channel, external_id,
  phone_number, direction, message_type, content,
  media_url, status, lead_id, metadata, created_at, updated_at
)
SELECT
  organization_id, instance_id, 'whatsapp', message_id,
  phone_number, direction, message_type, content,
  media_url, status, lead_id, metadata, created_at, updated_at
FROM whatsapp_messages;
```

#### Realtime

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE channel_messages;
```

### 2. Edge Functions

#### `meta-oauth-callback/index.ts`

Responsabilidades:
1. Recebe `code` do frontend apos redirect OAuth
2. Troca por short-lived token via `POST graph.facebook.com/v21.0/oauth/access_token`
3. Troca por long-lived token via `GET graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token`
4. Consulta `GET /me?fields=id,name` para dados do usuario
5. Consulta `GET /me/accounts?fields=id,name,access_token,instagram_business_account` para listar paginas
6. Para cada pagina com instagram_business_account, consulta `GET /{ig_id}?fields=username`
7. Subscreve cada pagina: `POST /{page_id}/subscribed_apps` com fields `messages,feed,leadgen`
8. Salva tudo em `meta_connections` + `meta_pages`
9. Retorna lista de paginas conectadas

#### `meta-webhook/index.ts`

Responsabilidades:
1. GET: responde challenge de verificacao do Meta (`hub.verify_token`)
2. POST: valida `X-Hub-Signature-256` com HMAC SHA256
3. Roteia por tipo de evento:
   - `messaging` (Messenger): cria mensagem em `channel_messages` com channel='messenger'
   - `instagram` (messaging): cria mensagem com channel='instagram'
   - `leadgen`: busca dados do lead via Graph API `GET /{leadgen_id}`, cria lead com origin='meta_ads'
4. Para mensagens: associa lead existente por sender_id ou cria novo
5. Para leadgen: cria lead com todos os campos do formulario

#### `send-meta-message/index.ts`

Responsabilidades:
1. Recebe: page_id, recipient_id, message_text, channel, media_url (opcional)
2. Busca page_access_token de `meta_pages`
3. Envia via Graph API:
   - Messenger: `POST graph.facebook.com/v21.0/{page_id}/messages`
   - Instagram: `POST graph.facebook.com/v21.0/{ig_account_id}/messages`
4. Salva mensagem outgoing em `channel_messages`
5. Retorna status

#### `refresh-meta-tokens/index.ts` (Cron diario)

1. Busca tokens com `token_expires_at < NOW() + INTERVAL '7 days'`
2. Renova via `GET graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token`
3. Atualiza token e token_expires_at
4. Se falhar: marca status='expired'

#### `_shared/meta-api.ts`

Helper functions:
- `exchangeCodeForToken(code)` - troca code por short-lived token
- `exchangeForLongLivedToken(token)` - troca por long-lived (~60 dias)
- `listPages(userToken)` - lista paginas com instagram_business_account
- `subscribePageWebhook(pageId, pageToken)` - subscreve eventos
- `sendMessage(pageToken, recipientId, message, channel)` - envia mensagem
- `getLeadgenData(leadgenId, pageToken)` - busca dados do lead form
- `verifyWebhookSignature(payload, signature, appSecret)` - valida HMAC

### 3. Frontend

#### Componente `ChannelBadge.tsx`

```tsx
// Props: channel: 'whatsapp' | 'instagram' | 'messenger', size?: number
// Renderiza bolinha com icone e cor:
//   - whatsapp: fundo verde (#25D366), icone WhatsApp
//   - instagram: fundo gradiente (#E1306C -> #833AB4), icone Instagram
//   - messenger: fundo azul (#0084FF), icone Messenger
// Posicionamento: absolute, bottom-right da foto do contato (20px)
```

#### Refactor do Chat

1. Renomear rota `/chat-whatsapp` -> `/chat` (manter redirect)
2. `useChannelContacts(orgId)` - query channel_messages agrupando por (phone/sender_id + channel)
3. `useChannelMessages(contactId, channel)` - mensagens de uma conversa
4. `useSendChannelMessage()` - detecta canal e roteia para Evolution API ou send-meta-message
5. `useChannelMessagesRealtime()` - subscription em channel_messages

#### Pagina de Configuracoes - Secao Meta

1. Card com botao "Conectar com Facebook" (azul, icone Meta)
2. Ao clicar: `window.location.href` para Meta Login Dialog URL
3. Callback URL: `/configuracoes?meta_code={code}` - frontend detecta e chama `meta-oauth-callback`
4. Apos conectado: lista paginas com nome, tipo (Messenger/Instagram), status
5. Indicador visual de token (verde=ok, amarelo=expirando, vermelho=expirado)
6. Botao "Desconectar"

#### Hook `useMetaConnection.ts`

- `useMetaConnections(orgId)` - lista conexoes + paginas
- `useConnectMeta()` - mutation que chama meta-oauth-callback
- `useDisconnectMeta()` - mutation que desconecta e remove webhooks
- `useMetaConnectionStatus()` - status real-time do token

### 4. Configuracao do Facebook App

Necessario na Meta for Developers:
- App Type: Business
- Products: Facebook Login, Webhooks, Messenger, Instagram Messaging, Marketing API
- Permissions: pages_manage_metadata, pages_messaging, instagram_manage_messages, leads_retrieval, pages_read_engagement
- Webhook URL: `{SUPABASE_URL}/functions/v1/meta-webhook`
- Verify Token: configuravel via env var `META_WEBHOOK_VERIFY_TOKEN`
- App Secret: env var `META_APP_SECRET`
- App ID: env var `META_APP_ID`

### 5. Variaveis de Ambiente (Edge Functions)

```
META_APP_ID=<facebook_app_id>
META_APP_SECRET=<facebook_app_secret>
META_WEBHOOK_VERIFY_TOKEN=<token_aleatorio_para_verificacao>
META_REDIRECT_URI=<url_de_callback_no_frontend>
```

---

## Plano de Implementacao

### Fase 1: Infraestrutura (banco + shared helpers)
1. Migration: criar tabelas channel_messages, meta_connections, meta_pages
2. Migration: migrar dados de whatsapp_messages para channel_messages
3. Migration: atualizar enum lead_origin
4. Criar _shared/meta-api.ts

### Fase 2: Autenticacao Meta
5. Edge function: meta-oauth-callback
6. Frontend: pagina de configuracoes com botao "Conectar com Facebook"
7. Hook: useMetaConnection
8. Componente: MetaConnectionCard + MetaPagesList

### Fase 3: Webhook + Recebimento de Mensagens
9. Edge function: meta-webhook (verificacao + messaging + leadgen)
10. Edge function: refresh-meta-tokens (cron)

### Fase 4: Chat Unificado
11. Componente: ChannelBadge
12. Refactor: useChannelContacts, useChannelMessages, useChannelMessagesRealtime
13. Refactor: ChatWhatsApp.tsx -> Chat unificado
14. Edge function: send-meta-message

### Fase 5: Lead Ads
15. Processamento de leadgen no meta-webhook
16. UI para configurar acoes pos-captura de Lead Ads

### Fase 6: Validacao
17. Testes end-to-end em modo dev
18. Submeter App para revisao do Meta


## Links relacionados

- [[Produtos]]

- [[Metas]]

- [[Webhooks]]

- [[Meta Facebook]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
