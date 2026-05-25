# Meta Chat — FASE 0 — Design

**Data:** 2026-05-25
**Owner:** Marcelo Montemezzo (CTO)
**Escopo:** Conectar Meta (Facebook/Instagram) ao Torque e permitir receber+responder mensagens de Messenger e Instagram Direct dentro do CRM, em rota dedicada, sem tocar no chat WhatsApp existente.
**Trello card:** "Meta Integração | FASE 0"

---

## 1. Contexto

### O que já existe (descoberta)

Backend Meta majoritariamente implementado:

| Camada | Status |
|---|---|
| OAuth Facebook + Instagram (`meta-oauth-callback`) | ✅ |
| Long-lived token + refresh cron (`refresh-meta-tokens`) | ✅ |
| Webhook inbound (`meta-webhook`) — Messenger, Instagram Direct, Leadgen | ✅ |
| Outbound (`send-meta-message`) — text + media | ✅ |
| Listagem formulários (`list-lead-forms`) + config Lead Ads (`MetaLeadgenConfig`) | ✅ |
| Tabelas: `meta_connections`, `meta_pages`, `meta_leadgen_configs`, `channel_messages` | ✅ |
| Lead creation a partir de Leadgen com field_mappings + campanha + round-robin | ✅ |
| Frontend Settings (`MetaSettings.tsx`) — conectar/desconectar/toggle/refetch | ✅ |
| UTM enrichment Meta Ads (Milennials only) | ✅ |

### Gap que FASE 0 ataca

Mensagens chegam em `channel_messages` mas **não há UI para visualizá-las nem respondê-las**. Cliente conecta IG → vê toast (via `useIncomingMessageToast`) → mensagem some.

### Decisões já tomadas

1. **Escopo FASE 0 = chat (inbound + outbound) apenas.** Métricas / dashboard Torque MKT / Conversion API feedback loop / migração multi-tenant insights ficam para fases futuras.
2. **Canais separados, não omnichannel unificado.** Mensagens Meta vivem em rota própria. Mesmo lead pode aparecer em /chat (WhatsApp) e /atendimento/meta (IG/Messenger) sem fusão. Decisão tomada para evitar refactor pesado no chat WhatsApp e isolar risco. Unificação fica como possível fase futura.

---

## 2. Arquitetura

### 2.1 Topologia

```
Meta (FB/IG)
    │
    ├── Webhook POST ──► [meta-webhook]
    │                       │
    │                       ├── upsert channel_messages
    │                       │       │
    │                       │       └── trigger upsert_meta_conversation
    │                       │                   │
    │                       │                   └── upsert meta_conversations
    │                       │
    │                       └── (leadgen) cria/atualiza lead
    │
    └── Graph API ◄── [send-meta-message] ◄── useMetaSend (frontend)
                            │
                            └── insert channel_messages (direction=outgoing)
                                    │
                                    └── trigger atualiza last_message_*

Frontend /atendimento/meta
    ├── useMetaPages       → meta_pages (org-scoped, active+subscribed)
    ├── useMetaConversations → meta_conversations (filtered by page)
    ├── useMetaMessages    → channel_messages (channel + sender_id + page_id)
    ├── useMetaRealtime    → postgres_changes em ambas tabelas
    ├── useMetaSend        → invoke send-meta-message
    ├── useMetaLinkLead    → update lead_id
    └── useMetaMarkAsRead  → RPC mark_meta_conversation_read
```

### 2.2 Princípio de isolamento

- Hooks Meta vivem em `src/hooks/chat-meta/` (paralelo a `src/hooks/chat/` do WhatsApp).
- Componentes em `src/components/chat-meta/` (paralelo a `src/components/chat/`).
- Rota dedicada `/atendimento/meta` (paralela a `/chat`).
- Reuso de primitivos visuais: `ChatShell` layout, `ChannelBadge`, `MessagePrimitives` (bubbles base), bubble styles. Nada compartilha estado mutável com o WhatsApp.

---

## 3. Data layer

### 3.1 Tabela `meta_conversations`

```sql
CREATE TABLE meta_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  meta_page_id uuid NOT NULL REFERENCES meta_pages(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('messenger','instagram')),
  external_user_id text NOT NULL,            -- PSID (messenger) ou IGSID (instagram)
  external_username text,                    -- nome do perfil Meta
  profile_pic_url text,                      -- CDN FB (expira ~horas)
  profile_pic_expires_at timestamptz,        -- cache TTL 24h
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  last_message_direction text CHECK (last_message_direction IN ('incoming','outgoing')),
  last_inbound_at timestamptz,               -- pra cálculo janela 24h
  unread_count int NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, channel, meta_page_id, external_user_id)
);

CREATE INDEX idx_meta_conv_org_chan_active
  ON meta_conversations (organization_id, channel, archived_at, last_message_at DESC);
CREATE INDEX idx_meta_conv_lead
  ON meta_conversations (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_meta_conv_page
  ON meta_conversations (meta_page_id, last_message_at DESC);
```

### 3.2 RLS

```sql
ALTER TABLE meta_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY meta_conv_select_org ON meta_conversations
  FOR SELECT
  USING (organization_id IN (SELECT get_my_organization_ids()));

CREATE POLICY meta_conv_update_org ON meta_conversations
  FOR UPDATE
  USING (organization_id IN (SELECT get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

-- Service role bypassa (insert/upsert vem só via trigger ou edge function)
```

**Atenção CLAUDE.md gotcha:** usar `get_my_organization_ids()` (SECURITY DEFINER) — nunca subquery inline em `team_members` para evitar recursão sob Realtime.

### 3.3 Trigger `upsert_meta_conversation`

```sql
CREATE OR REPLACE FUNCTION upsert_meta_conversation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_page_uuid uuid;
BEGIN
  IF NEW.channel NOT IN ('messenger','instagram') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_page_uuid
    FROM meta_pages
   WHERE organization_id = NEW.organization_id
     AND page_id = NEW.page_id
   LIMIT 1;

  IF v_page_uuid IS NULL THEN
    RETURN NEW; -- mensagem sem page conhecida, ignora (defesa)
  END IF;

  INSERT INTO meta_conversations (
    organization_id, meta_page_id, channel, external_user_id,
    last_message_at, last_message_preview, last_message_direction,
    last_inbound_at, unread_count, lead_id
  ) VALUES (
    NEW.organization_id, v_page_uuid, NEW.channel, NEW.sender_id,
    NEW.timestamp,
    LEFT(COALESCE(NEW.content, '[' || NEW.message_type || ']'), 200),
    NEW.direction,
    CASE WHEN NEW.direction = 'incoming' THEN NEW.timestamp ELSE NULL END,
    CASE WHEN NEW.direction = 'incoming' THEN 1 ELSE 0 END,
    NEW.lead_id
  )
  ON CONFLICT (organization_id, channel, meta_page_id, external_user_id)
  DO UPDATE SET
    last_message_at      = GREATEST(meta_conversations.last_message_at, NEW.timestamp),
    last_message_preview = LEFT(COALESCE(NEW.content, '[' || NEW.message_type || ']'), 200),
    last_message_direction = NEW.direction,
    last_inbound_at = CASE
      WHEN NEW.direction = 'incoming' THEN GREATEST(COALESCE(meta_conversations.last_inbound_at, NEW.timestamp), NEW.timestamp)
      ELSE meta_conversations.last_inbound_at
    END,
    unread_count = CASE
      WHEN NEW.direction = 'incoming' THEN meta_conversations.unread_count + 1
      ELSE meta_conversations.unread_count
    END,
    lead_id = COALESCE(NEW.lead_id, meta_conversations.lead_id),
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_meta_conv_upsert
  AFTER INSERT ON channel_messages
  FOR EACH ROW EXECUTE FUNCTION upsert_meta_conversation();
```

### 3.4 Backfill one-time

```sql
-- Idempotente: roda upsert para cada channel_message existente em ordem.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM channel_messages
     WHERE channel IN ('messenger','instagram')
     ORDER BY timestamp ASC
  LOOP
    PERFORM upsert_meta_conversation_for_row(r); -- helper que replica lógica
  END LOOP;
END $$;
```

Helper `upsert_meta_conversation_for_row(channel_messages)` extrai a lógica do trigger pra reaproveitar no backfill sem precisar replay de INSERTs.

### 3.5 RPC `mark_meta_conversation_read`

```sql
CREATE OR REPLACE FUNCTION mark_meta_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM meta_conversations WHERE id = p_conversation_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF v_org NOT IN (SELECT get_my_organization_ids()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE meta_conversations
     SET unread_count = 0, updated_at = now()
   WHERE id = p_conversation_id;

  UPDATE channel_messages cm
     SET status = 'read'
    FROM meta_conversations mc, meta_pages mp
   WHERE mc.id = p_conversation_id
     AND mp.id = mc.meta_page_id
     AND cm.organization_id = mc.organization_id
     AND cm.channel = mc.channel
     AND cm.page_id = mp.page_id
     AND cm.sender_id = mc.external_user_id
     AND cm.direction = 'incoming'
     AND cm.status <> 'read';
END;
$$;

GRANT EXECUTE ON FUNCTION mark_meta_conversation_read(uuid) TO authenticated;
```

### 3.6 RPC `link_meta_conversation_to_lead`

```sql
CREATE OR REPLACE FUNCTION link_meta_conversation_to_lead(
  p_conversation_id uuid,
  p_lead_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_lead_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM meta_conversations WHERE id = p_conversation_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF v_org NOT IN (SELECT get_my_organization_ids()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT organization_id INTO v_lead_org FROM leads WHERE id = p_lead_id;
  IF v_lead_org <> v_org THEN RAISE EXCEPTION 'lead_org_mismatch'; END IF;

  -- vincula conversa
  UPDATE meta_conversations SET lead_id = p_lead_id, updated_at = now()
   WHERE id = p_conversation_id;

  -- retroativo: vincula mensagens órfãs do mesmo (channel, sender_id, page)
  UPDATE channel_messages cm
     SET lead_id = p_lead_id
    FROM meta_conversations mc, meta_pages mp
   WHERE mc.id = p_conversation_id
     AND mp.id = mc.meta_page_id
     AND cm.organization_id = mc.organization_id
     AND cm.channel = mc.channel
     AND cm.page_id = mp.page_id
     AND cm.sender_id = mc.external_user_id
     AND cm.lead_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION link_meta_conversation_to_lead(uuid, uuid) TO authenticated;
```

---

## 4. Edge functions

### 4.1 Nova: `meta-conversation-profile`

**Endpoint:** `POST /functions/v1/meta-conversation-profile`
**Body:** `{ conversationId: string }`
**Auth:** `requireAuth` + org-match.

Comportamento:
1. Lookup `meta_conversations` por id, valida `organization_id` do auth.
2. Lookup `meta_pages` por `meta_page_id`, obtém `page_access_token`.
3. Se `profile_pic_expires_at > now()` → retorna cache.
4. Fetch Graph API (`v21.0`):
   - Messenger: `GET /{psid}?fields=name,profile_pic&access_token={page_token}`
   - Instagram: `GET /{igsid}?fields=name,profile_pic&access_token={page_token}`
5. Update `meta_conversations` com `external_username`, `profile_pic_url`, `profile_pic_expires_at = now() + interval '24 hours'`.
6. Retorna `{ external_username, profile_pic_url }`.

Falha non-fatal: log + retorna 200 com `{ external_username: null, profile_pic_url: null }` para UI render fallback initials.

### 4.2 Reuso sem alteração

- `meta-webhook` — já salva em `channel_messages`. Trigger faz resto.
- `send-meta-message` — já existe, já salva outbound em `channel_messages`. **Validar**: garantir que `page_id` no insert é o page_id string (não UUID), e que `timestamp` está consistente.
- `meta-oauth-callback`, `refresh-meta-tokens` — sem mudanças.

### 4.3 Pequeno ajuste em `meta-webhook` (opcional)

Hoje o webhook não atualiza `status='read'` para outbound — irrelevante para FASE 0. Marcação delivery/read via Meta event (`message_reads`) fica para fase futura.

---

## 5. Frontend

### 5.1 Estrutura de arquivos

```
src/pages/AtendimentoMeta.tsx                   (lazy)

src/components/chat-meta/
  MetaChatShell.tsx                             wraps ChatShell
  MetaConversationList.tsx
  MetaConversationListItem.tsx
  MetaChatHeader.tsx
  MetaMessageList.tsx
  MetaMessageBubble.tsx                         (text + image)
  MetaComposer.tsx                              (text + image upload)
  MetaWindowWarning.tsx                         (janela 24h)
  LinkLeadDialog.tsx
  EmptyState.tsx
  ChatMetaSkeleton.tsx

src/hooks/chat-meta/
  useMetaPages.ts
  useMetaConversations.ts
  useMetaMessages.ts
  useMetaRealtime.ts
  useMetaSend.ts
  useMetaLinkLead.ts
  useMetaMarkAsRead.ts
  useMetaConversationProfile.ts
  types.ts
```

### 5.2 Hooks

**`useMetaPages`** — `meta_pages` da org, `is_active=true AND webhook_subscribed=true`, ordenado por nome. Output: `{ pages, byChannel: { messenger, instagram } }`.

**`useMetaConversations(pageId, channel, tab)`** — query `meta_conversations` filtrado por page + channel + archived state. `queryKey: ['meta_conversations', organizationId, pageId, channel, tab]`. Inclui join leve com `leads(id, name, phone)` para mostrar nome do lead quando vinculado.

**`useMetaMessages(conversationId)`** — query `channel_messages` por (organization_id, channel, page_id, sender_id) derivados da conversation. Paginação cursor-based por timestamp DESC, 50 por página. `queryKey: ['meta_messages', conversationId]`.

**`useMetaRealtime(organizationId)`** — `useRealtimeSubscription` em `meta_conversations` e `channel_messages`, ambos filtrados por org. Patches incrementais (sem refetch full). Debounce 2s.

**`useMetaSend(conversation)`** — mutation invoca `send-meta-message`. Optimistic update em `channel_messages` query cache. Em erro de janela 24h, mantém otimista marcado como `failed` e mostra toast claro.

**`useMetaLinkLead`** — mutation RPC `link_meta_conversation_to_lead`. Invalida `['meta_conversations', ...]` e `['meta_messages', conversationId]`.

**`useMetaMarkAsRead`** — mutation RPC `mark_meta_conversation_read`. Chamada on conversation open + on tab focus.

**`useMetaConversationProfile(conversationId)`** — chamada quando row não tem `external_username` ou `profile_pic_expires_at < now()`. Invoca edge function. Reflete via invalidate.

### 5.3 Componentes — comportamento

**`AtendimentoMeta.tsx`** — page wrapper, gate de visibilidade (redirect se org não tem pages Meta ativas), monta `MetaChatShell`.

**`MetaChatShell.tsx`** — 3 colunas via `ChatShell`. Header global com:
- Selector page (`MetaChatHeader`): se org tem 1 page só, hide. Se múltiplas, dropdown agrupado por canal.
- Toggle canal: tabs Messenger | Instagram (se org tem ambos).
- Tabs estado: Ativas | Arquivadas.

**`MetaConversationList`** — renderiza `MetaConversationListItem` em virtualized list (mesmo padrão WhatsApp). Loading skeleton, empty state, sentinel infinite scroll.

**`MetaConversationListItem`** — avatar (profile_pic_url ou initials fallback), nome (`external_username` ou "@ig_user" ou "Usuário do Messenger"), badge canal, preview last_message, timestamp relativo, unread badge dot, lead chip se vinculado.

**`MetaMessageList`** — bubbles cronológicas. Reuso `MessagePrimitives` para estilo. `MetaMessageBubble` lida com:
- text → bubble simples.
- image → bubble com `MessageMedia` (componente existente).
- video/file/audio → bubble "tipo não suportado nesta versão" com link raw (FASE 0).

**`MetaComposer`** — textarea + botão image upload (Supabase Storage `chat-media` bucket → URL pública → enviar como `mediaUrl + mediaType='image'`). Botão enviar disable se janela 24h fechada. Atalho Enter envia, Shift+Enter quebra linha (mesmo padrão WhatsApp).

**`MetaWindowWarning`** — banner acima do composer quando `now() - last_inbound_at > 24h`. Texto: "Janela de 24 horas fechada. Aguarde o cliente enviar uma nova mensagem para responder."

**`LinkLeadDialog`** — search bar com `useLeads` paginado por nome/email/phone. Click vincula via `useMetaLinkLead`. Mostra opção "Criar novo lead a partir desta conversa" → cria lead com nome do perfil Meta + origin='meta_chat'.

**`EmptyState`** — quando page sem conversas, ilustra: "Conecte uma página em Configurações > Integrações Meta para começar."

### 5.4 Sidebar

`src/components/layout/Sidebar.tsx` — adicionar item "Mensagens Meta" sob "Atendimento" (ou criar grupo "Atendimento" se já não houver). Gate: render apenas se `useMetaPages().pages.length > 0`. Ícone: gradient Instagram + Messenger.

### 5.5 Rota

`src/App.tsx` — adicionar lazy route `/atendimento/meta` apontando para `AtendimentoMeta`. Protected pelo mesmo wrapper de auth.

---

## 6. Janela 24 horas

Política Meta:
- Standard messaging: 24h após última msg inbound.
- Fora da janela: bloqueado (a menos que use message tags — não cobre FASE 0).

UI:
- `MetaComposer` lê `conversation.last_inbound_at`. Se `Date.now() - last_inbound_at > 24*3600*1000` → disable + `MetaWindowWarning`.
- Backend defesa: se Meta retornar erro `(#10) The user hasn't sent a message in the last 24h`, salvar `channel_messages` com `status='failed'` e razão. Toast mostra mensagem clara.

---

## 7. Realtime

`useMetaRealtime(organizationId)` usa `useRealtimeSubscription`:

```ts
useRealtimeSubscription(
  'meta_conversations',
  ['meta_conversations', organizationId],
  { filter: `organization_id=eq.${organizationId}`, debounceMs: 2000 }
);

useRealtimeSubscription(
  'channel_messages',
  ['meta_messages'], // invalida todas as conversations abertas
  {
    filter: `organization_id=eq.${organizationId}`,
    debounceMs: 2000,
    onChange: (payload) => {
      // patch incremental no cache da conversa correta
    }
  }
);
```

Atenção: RLS de `channel_messages` precisa estar via `get_my_organization_ids()` (não subquery inline em team_members) — confirmar policy existente. Se necessário, migration corretiva.

---

## 8. Segurança

| Vetor | Mitigação |
|---|---|
| Tenant leak via meta_conversations | RLS SELECT/UPDATE via `get_my_organization_ids()`. INSERT só via trigger SECURITY DEFINER. |
| Tenant leak via RPCs | `mark_meta_conversation_read` e `link_meta_conversation_to_lead` checam org-match antes de mutar. |
| Tenant leak edge function | `meta-conversation-profile` faz `requireAuth` + valida `meta_pages.organization_id == auth.organizationId`. |
| Page access token leak | `meta_pages.page_access_token` nunca retornado ao client. RLS deny client SELECT da coluna via view sanitizada (se necessário, criar `meta_pages_safe` view sem token). |
| Profile pic CDN URL exposto | Tudo bem, é público por design Meta. Lazy refetch on 404. |
| Realtime recursão RLS | Confirmar policies de `channel_messages` e `meta_conversations` usam SECURITY DEFINER helpers. |
| Spoofed webhook | `meta-webhook` já valida HMAC `x-hub-signature-256`. ✅ |
| Outbound send autorizado | `send-meta-message` já valida org via `requireAuth` + page org-match. ✅ |
| Lead linkagem cross-org | RPC checa `leads.organization_id == auth.organizationId`. |
| Profile fetch rate limit Meta | Cache 24h via `profile_pic_expires_at`. Worst case: 1 fetch/conversa/dia. |

---

## 9. Testing

### 9.1 Unit (Vitest)

- `useMetaConversations` — query key, filter, order by last_message_at DESC, lead join.
- `useMetaMessages` — pagination cursor, filter por sender+page+channel.
- `useMetaSend` — optimistic update, rollback em erro, janela 24h check.
- `useMetaLinkLead` — RPC invocation, invalidations corretas.
- `useMetaMarkAsRead` — invocação on mount + on focus.
- `useMetaConversationProfile` — não chama se cache válido.
- `MetaWindowWarning` — render condicional baseado em `last_inbound_at`.
- `LinkLeadDialog` — search debounce, "criar novo lead" flow.

### 9.2 Integration (Vitest + Supabase local)

- Trigger `upsert_meta_conversation`:
  - insert inbound novo → cria conversa com unread=1, last_inbound_at set.
  - insert inbound em conversa existente → unread+1.
  - insert outbound → unread inalterado, last_message_direction=outgoing.
  - insert com lead_id → propaga, e respeita COALESCE em updates posteriores.
  - insert sem meta_pages match → não cria conversa (silent skip).
- RPC `mark_meta_conversation_read` — zera unread, atualiza status nas msgs corretas, falha cross-org.
- RPC `link_meta_conversation_to_lead` — vincula + retroativo, falha cross-org, falha lead inexistente.
- RLS — query como user de outra org retorna zero.

### 9.3 E2E (Playwright)

1 cenário golden path:
1. Login como user org X com Meta conectado.
2. Mock webhook POST em `meta-webhook` com payload inbound IG.
3. Navegar para `/atendimento/meta` → conversa nova aparece (via realtime).
4. Click na conversa → thread renderiza → unread zera.
5. Digitar reply, send → bubble outbound aparece otimista → realtime confirma.
6. Mock segunda mensagem inbound → bubble entra sem refetch full.

### 9.4 Smoke prod-like

Antes de merge final, sub-agente engenheiro testa em dev Supabase com Meta app real:
- Conectar IG sandbox → enviar DM real → confirmar bubble aparece.
- Responder → confirmar entrega no IG.
- Repetir para Messenger.

---

## 10. Roadmap de execução

| Sub-fase | Owner sub-agente | Saída | Bloqueia |
|---|---|---|---|
| **0.1 Infra DB** | engenheiro | Migration `meta_conversations` + trigger + RLS + índices + helper backfill. Integration tests. | 0.2, 0.3 |
| **0.2 Edge fns + RPCs** | engenheiro | `meta-conversation-profile` edge fn. RPCs `mark_meta_conversation_read`, `link_meta_conversation_to_lead`. Tests. | 0.3 |
| **0.3 Hooks** | engenheiro | Todos `useMeta*` em `src/hooks/chat-meta/`. Unit tests. | 0.4, 0.5 |
| **0.4 UI lista + rota + sidebar** | design + engenheiro | `AtendimentoMeta`, `MetaChatShell`, `MetaConversationList*`, sidebar gate. Visual world-class. | 0.5 |
| **0.5 UI thread + composer + janela 24h** | design + engenheiro | `MetaMessageList`, `MetaMessageBubble`, `MetaComposer` (text+image), `MetaWindowWarning`. | 0.6 |
| **0.6 LinkLead + mark-read + profile** | engenheiro | `LinkLeadDialog`, integração `useMetaMarkAsRead`, lazy profile fetch. | 0.7 |
| **0.7 QA + docs** | engenheiro | E2E Playwright, smoke real, docs Obsidian (`02-Arquitetura/Modulos/atendimento-meta.md` + ADR canal separado vs unificado + How-to debug Meta chat). | — |

Cada sub-fase = 1 PR em branch própria (`feat/meta-chat-fase-0/<sub-fase>`), arquiteto faz commit+push. Default dev (sem deploy prod).

---

## 11. Out of scope FASE 0

- Unificação omnichannel.
- Dashboard Torque MKT (métricas Meta Ads).
- Conversion API feedback loop (qualificação → audiência).
- Migração `meta-ads-insights` de env global → OAuth token multi-tenant.
- Composer extras: stickers, reactions, voice notes, quick replies, buttons.
- Replies a Stories, Mentions, Comments de posts.
- Message tags fora da janela 24h.
- Delivery/Read receipts inbound (eventos `message_deliveries` / `message_reads`).
- Sender actions (`typing_on`, `mark_seen` outbound).

---

## 12. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Webhook silently unsubscribe de uma page | Média | Healthcheck on shell mount: `GET /{page_id}/subscribed_apps`. Mostrar banner amarelo + botão "Resubscrever". |
| Token long-lived expira sem refresh | Baixa | Cron `refresh-meta-tokens` já existe. UI Settings já mostra warning <7d. |
| Janela 24h fecha enquanto user digita | Média | Composer revalida `last_inbound_at` no submit. Erro Meta tratado com toast claro. |
| Profile pic URL expira mid-render | Alta | `<img onError>` → trigger refetch via `useMetaConversationProfile`. Fallback initials. |
| Trigger recursão | N/A | Trigger só toca `meta_conversations`, não `channel_messages`. |
| Backfill explode em org grande | Baixa | Script idempotente, ORDER BY timestamp ASC, processa em chunks de 1000. |
| Realtime perde evento | Média | Polling fallback (interval 30s) opcional. Inicialmente confiar em postgres_changes — alinha com WhatsApp. |
| Page tem token sem `pages_messaging` scope (conexão antiga) | Média | Detectar erro 403 no send → mostrar "Reconecte sua página para enviar mensagens" + CTA settings. |
| Org tem meta_connections de múltiplos users que conectaram a mesma page | Baixa | Unique key `(organization_id, page_id)` em meta_pages já existe (upsert no callback). |

---

## 13. Métricas de sucesso FASE 0

Critério de aceite Trello: "Ao clicar e logar com o facebook, ele já puxa os formularios nativos e as conversas do direct começam a aparecer."

Tradução operacional:
1. Cliente clica "Conectar com Facebook/Instagram" em Settings → completa OAuth.
2. Formulários Lead Ads aparecem listados (já funciona, sem mudança).
3. Mensagens IG Direct + Messenger aparecem em `/atendimento/meta` em tempo real.
4. Cliente consegue responder e o cliente final recebe no IG/Messenger.
5. Mensagens novas após primeira aparecem sem refresh manual (realtime).
6. Cliente consegue vincular conversa a um lead existente ou criar novo.
7. Zero regressão no `/chat` WhatsApp.
