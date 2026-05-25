# Atendimento Meta

Rota: `/atendimento/meta`. Chat dedicado para Messenger + Instagram Direct, isolado do chat WhatsApp.

## Backend
- `meta-webhook` salva inbound em `channel_messages`.
- Trigger `trg_meta_conv_upsert` mantém `meta_conversations` (agregação por (page, external_user)).
- `send-meta-message` envia outbound + salva.
- `meta-conversation-profile` enriquece nome/foto via Graph API (cache 24h).
- RPCs: `mark_meta_conversation_read`, `link_meta_conversation_to_lead`.

## Frontend
- Hooks: `src/hooks/chat-meta/`
- Componentes: `src/components/chat-meta/`
- Page: `src/pages/AtendimentoMeta.tsx`
- Gate sidebar: visível se `meta_pages.is_active=true` para a org.

## Restrições conhecidas
- Janela 24h Meta: composer disable se `now - last_inbound_at > 24h`.
- Profile pic CDN expira: lazy refetch on 404.
- FASE 0 não suporta: stickers, reactions, voice notes, story replies, comment replies, message tags.

Spec: `docs/superpowers/specs/2026-05-25-meta-chat-fase-0-design.md`
Plan: `docs/superpowers/plans/2026-05-25-meta-chat-fase-0.md`
