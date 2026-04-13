---
tags:
  - claude-code
  - feature
  - torque-crm
  - admin
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Configuracoes

## O que faz

Hub de configuracoes com 8+ tabs: Tags, Notificacoes, WhatsApp, Integracoes, Webhooks, API, Geral, Help. Ponto central para todas as configs da org.

## Regras de negocio

- Apenas admin tem acesso a maioria das tabs
- Tags tem name + color unique por org
- Overdue days configuraveis para pipe_confirmacao
- Integracoes mostram catalogo de servicos disponiveis

## Como o usuario usa

1. Configuracoes no menu lateral
2. Navega entre tabs
3. Cada tab tem suas configuracoes especificas
4. Salva → aplica imediatamente

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Configuracoes.tsx` — Tab routing principal
- `src/components/settings/WhatsAppSettings.tsx` — Config WhatsApp
- `MetaSettings.tsx` — Meta Ads
- `GoogleCalendarSettings.tsx` — Google Calendar
- `TinyErpSettings.tsx` — TinyERP
- `WebhookSettings.tsx` — Webhooks
- `IntegrationsCatalog.tsx` — Catalogo de integracoes
- `ElevenLabsSettings.tsx` — TTS
- `ThemeSettings.tsx` — Tema
- `ProfileSettings.tsx` — Perfil
- `MetaLeadgenConfig.tsx` — Lead Ads config
- `help/HelpCenter.tsx` — Help docs
- `api-docs/ApiDocsSettings.tsx` — API docs

### Hooks

- `useTags()` / `useCreateTag()` / `useUpdateTag()` / `useDeleteTag()`
- `useOrganizationSettings()` — Config da org
- `useIsAdmin()` — Permission check

### Tabelas

- `tags` — name, color, organization_id
- `organization_settings` — Preferences

---

## Historico de mudancas

## Links relacionados

- [[Webhooks]]
- [[WhatsApp Evolution]]
- [[Meta Facebook]]
- [[Google Calendar]]
- [[TinyERP]]
