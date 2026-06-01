# Module — integrations

**Status:** 🟢 Active — superfície atual mínima (3 arquivos: `useGoogleCalendar`, `useGoogleCalendarSharing`, index). Mantido como BC distinto por ser **alvo de expansão futura** — TinyERP, Asaas, Meta, SZ.Chat, Cal.com, ElevenLabs, Uazapi hoje vivem em edge functions com UI fragmentada nos consumidores. Consolidação progressiva pra cá.
**BC:** integrations (cross-cutting)
**Entidade primária:** Provider adapter (por provider)
**Owner:** ops / plataforma
**Decisão pós-modularização (fase 4 — 2026-05-28):** mantido separado (não absorvido em `platform`). Razão: convergência prevista de providers conforme novas integrações entram. Reavaliar se em 6 meses superfície continuar abaixo de 5 hooks.

## Escopo

Adapters para provedores externos. Cada integração isolada em subpasta. Outros módulos consomem via API pública (port-and-adapter).

Providers ativos:
- **Google Calendar** — sync de reunião + availability + sharing
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
- Webhook routing genérico → `platform`

## API pública (`index.ts`)

**Hooks (slice 16 longtail):**
- `useGoogleCalendar` — sync de reunião + availability
- `useGoogleCalendarSharing` — convidar participantes + ACL

Demais providers seguem em edge functions (`supabase/functions/`) com mapping doc-only em slice 15 — sem move físico (Supabase CLI exige flat layout).

## Áreas frágeis

- **Token refresh** — Meta/Google tokens expiram, precisam refresh proativo
- **Rate limit** — Uazapi/Meta têm rate limits estritos
- **Webhook signature verification** — Asaas, TinyERP, Meta — cada um com seu esquema
- **OAuth callback URLs** — change provider config → break

## Backend (NÃO migrado — fica em `supabase/functions/`)

Ver `supabase/functions/CLAUDE.md` slice 15 doc-only mapping. Edge functions integrations:
- `google-calendar-*` (6 functions)
- `meta-oauth-callback`, `meta-ads-insights`, `meta-conversation-profile`, `refresh-meta-tokens`
- `tinyerp-*` (8 functions) + `erp-order-webhook`
- `elevenlabs-proxy`
- `sz-chat-send`, `sz-chat-webhook` (cross-cut com `communication`)
- `webhook-calcom`
- `partner-webhook` (auditar)
- `_shared/google-calendar-utils.ts`, `meta-api.ts`, `tinyerp-utils.ts`, `asaas.ts`, `tts-elevenlabs.ts`

## Dedup pendente

- `_shared/asaas.ts` — caller único? (memória sugere órfão)
- `partner-webhook` — para qual parceiro? auditar

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Integrações vault: `Obsidian/.../02 — Arquitetura/Integracoes.md`
