---
type: changelog
title: BL-WA-05 — Captura mensagens de grupo
status: shipped
created: 2026-05-15
updated: 2026-05-15
tags: [uncategorized]
related: []
owner: gabriel
---



# BL-WA-05 — Captura mensagens de grupo

Decisão produto **D2=A** (CTO 2026-05-15): capturar mensagens de grupo com `is_group:true`, mostrar em tab separada no chat sidebar, **não** criar lead pra membro de grupo, toggle `organizations.capture_groups` permite opt-out por org (default = true).

Antes: `whatsapp-webhook` dropava qualquer evento com `remote_jid` terminado em `@g.us`. Orgs B2B (Barulinho Bom, Mapila) usavam grupos críticos pra vendas e ficavam cegas.

## Componentes

- **Migration**: `20261013000002_whatsapp_messages_is_group.sql`
  - `whatsapp_messages.is_group boolean NOT NULL DEFAULT false`
  - `organizations.capture_groups boolean NOT NULL DEFAULT true`
  - Index parcial `idx_whatsapp_messages_groups` em `is_group=true`
- **Patch webhook** (`supabase/functions/whatsapp-webhook/index.ts`):
  - `normalizeMessage` populates `is_group: jidStr.endsWith("@g.us")`
  - Drop guard substituído por: respeita `capture_groups` org flag (false → drop legacy)
  - Mensagem de grupo: persistida → `agent-message`, `resolve_wait_response_by_phone`, pipeline upserts **pulam** (early return)
- **Frontend**:
  - `src/hooks/chat/types.ts` — `ChatContact.is_group: boolean` adicionado
  - `src/hooks/chat/useWhatsAppContacts.ts` — query inclui `is_group`, popula no contact
  - `src/components/chat/list/ConversationList.tsx` — botão pill "Grupos" no filtro (toggle local). Quando ON: mostra só grupos. Quando OFF (default): esconde grupos da lista normal.
  - `src/components/chat/bubble/ChatBubbleConversationList.tsx` — fixture inclui `is_group: false`
  - `tests/unit/use-chat-bubble-contacts-realtime.test.ts` — fixture atualizada

## Comportamento

| Cenário | Resultado |
|---|---|
| Mensagem 1:1 chega | `is_group=false`, comportamento inalterado, lead/copilot/pipeline executam |
| Mensagem grupo chega + capture_groups=true (default) | `is_group=true`, persistida, lead/copilot/pipeline pulam |
| Mensagem grupo chega + capture_groups=false | Drop silencioso (legacy) + log `uazapi_group_message_skipped reason: capture_groups_off` |
| Org admin liga toggle "Grupos" no sidebar | Lista mostra só conversas de grupo |
| Default sidebar | Lista hide grupos (preserva UX 1:1 atual) |

## Critério de aceite

- [x] Mensagem de grupo chega → aparece quando user toggle "Grupos" no sidebar
- [x] Lead não é criado pra membro de grupo (early return antes de qualquer side-effect downstream)
- [x] Toggle preference: `organizations.capture_groups` por org
- [x] Backwards compat: 1:1 messages comportam idêntico

## Limitações conhecidas

- **history-sync-worker** ainda dropa @g.us na linha 147 — mensagens históricas de grupo não fazem backfill. Backlog separado (BL-WA-05b) pra patch.
- Group "name" mostra como `phone_number` (ID do grupo). Subject do grupo (`pushName` do payload de grupo) requer parsing adicional. Iteração futura.
- Sem typing indicator humano em grupos.

## Verificação

Após aplicar prod:
```sql
-- Confirma migration
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'whatsapp_messages' AND column_name = 'is_group';

-- Conta grupos capturados
SELECT count(*), count(DISTINCT phone_number) AS grupos_distintos
FROM whatsapp_messages
WHERE is_group = true AND created_at > now() - interval '1 hour';

-- Org pode optar opt-out
UPDATE organizations SET capture_groups = false WHERE id = '<uuid>';
```

## Próximos passos prod

Pendente autorização explícita CTO (hook bloqueou nomeando `jsjsmuncfkbsbzqzqhfq`):

```bash
npx supabase db push                                                     # aplica migration 13000002
npx supabase functions deploy whatsapp-webhook --project-ref jsjsmuncfkbsbzqzqhfq
```

Frontend deploy via push main → Docker → EasyPanel automático.

## Notas

- Contagem de grupos no badge ajuda user a saber quando há atividade.
- `capture_groups` flag pode ser exposta no settings UI futuro (atualmente só via SQL).
