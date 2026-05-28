# Module — integrations

**Status:** 🟡 Skeleton (slice 13 popula)
**BC:** integrations (cross-cutting)
**Entidade primária:** Provider adapter (por provider)
**Owner:** ops / plataforma

## Escopo

Adapters para provedores externos. Cada integração isolada em subpasta. Outros módulos consomem via API pública (port-and-adapter).

Providers ativos:
- **Google Calendar** — sync de reunião + availability
- **Google Drive** — anexos (futuro)
- **Google Sheets** — append row (mass export)
- **Meta** (Graph API) — Messenger/Instagram inbox + ads insights + OAuth
- **TinyERP** — push de pedido, NFe, products sync
- **Asaas** — pagamento (cross-cut com `billing`)
- **SZ.Chat** — canal experimental (cross-cut com `communication`)
- **Cal.com** — agendamento alternativo
- **ElevenLabs** — TTS (cross-cut com `copilot`)
- **Uazapi** — WhatsApp provider (cross-cut com `communication`)

## Não-escopo

- Lógica de negócio que CONSOME o provider → módulos respectivos (`carteira` consome `tinyerp`, `communication` consome `meta`)
- Webhook routing genérico → `platform`?

## API pública (`index.ts`) — TBD slice 13

Provável estrutura:
- `integrations/google-calendar/` — `useGoogleCalendar`, `useGoogleCalendarSharing`
- `integrations/meta/` — Meta adapter + `useMetaConnection`
- `integrations/tinyerp/` — TinyERP adapter + `useTinyErp`
- ...etc

Cada subpasta tem seu próprio sub-CLAUDE.md (popula slice 13).

## Áreas frágeis

- **Token refresh** — Meta/Google tokens expiram, precisam refresh proativo
- **Rate limit** — Uazapi/Meta têm rate limits estritos
- **Webhook signature verification** — Asaas, TinyERP, Meta — cada um com seu esquema
- **OAuth callback URLs** — change provider config → break

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/hooks/useGoogleCalendar.ts`, `useGoogleCalendarSharing.ts`
- `src/hooks/useMetaConnection.ts`
- `src/hooks/useTinyErp.ts`

Backend:
- `supabase/functions/google-calendar-*` (6 functions)
- `supabase/functions/meta-oauth-callback/`, `meta-ads-insights/`, `meta-conversation-profile/`, `refresh-meta-tokens/`
- `supabase/functions/tinyerp-*` (8 functions) + `erp-order-webhook/`
- `supabase/functions/elevenlabs-proxy/`
- `supabase/functions/sz-chat-send/`, `sz-chat-webhook/` (cross-cut)
- `supabase/functions/webhook-calcom/`
- `supabase/functions/partner-webhook/` (auditar)
- `supabase/functions/_shared/google-calendar-utils.ts`, `meta-api.ts`, `tinyerp-utils.ts`, `asaas.ts`, `tts-elevenlabs.ts`

## Slice de migração

**Slice 13** (cross-cut) ou **Slice 15** — `feat/modularizacao/14-edge-functions` (6h + 3h auditoria webhook ambíguos)

Maior parte do volume está em edge functions — provavelmente migra junto com slice 15.

## Dedup pendente

- `_shared/asaas.ts` — caller único? (memória sugere órfão)
- `partner-webhook` — para qual parceiro? auditar

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Integrações vault: `Obsidian/.../02 — Arquitetura/Integracoes.md`
