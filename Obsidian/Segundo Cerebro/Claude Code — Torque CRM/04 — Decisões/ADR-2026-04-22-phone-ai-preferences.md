---
tags:
  - adr
  - torque-crm
  - arquitetura
  - ia
  - whatsapp
created: 2026-04-22
status: accepted
authors:
  - agent-conductor
  - agent-architect
  - agent-security
  - agent-dba
  - agent-backend
  - agent-frontend
  - agent-qa
---

# ADR — phone_ai_preferences como fonte única do toggle de IA

## Status

Accepted — 2026-04-22

## Contexto

Três incidentes em produção (REALSC, 2026-04-22) expuseram inconsistência estrutural no toggle "IA" do chat WhatsApp:

1. IA respondendo em cima do humano em conversa iniciada pelo operador (gap entre gerar resposta e enviar pelo Evolution API não re-checa flag).
2. Toggle falhando silenciosamente em contato sem lead — RPC `toggle_conversation_ai` tenta INSERT shadow lead com `origin='shadow_ai_toggle'` (valor inexistente no enum `lead_origin`). 7 retries em 7s, IA nunca desliga.
3. Primeira mensagem do contato cria lead com `ai_disabled=false` default, ignorando qualquer intenção prévia do vendedor.

Causa raiz estrutural: flag `ai_disabled` mora em `leads.ai_disabled`. Sem lead = sem entidade pra guardar preferência. Contorno (shadow lead) estava quebrado, não versionado em migration, com normalização de telefone divergente do resto do sistema.

## Decisão

**Mover a fonte de verdade do estado "IA ligada/desligada" para uma tabela dedicada: `phone_ai_preferences(organization_id, normalized_phone, ai_disabled, set_by, set_at)`.**

`leads.ai_disabled` permanece como denormalização mantida em sincronia pelas RPCs — consumidores legados (agent-message, evolution-webhook, get_lead_ai_status) não mudam.

### Componentes

- **Tabela nova** `phone_ai_preferences`, PK composta `(organization_id, normalized_phone)`, RLS ativa com SELECT por team_member ativo da org. Sem policy de INSERT/UPDATE/DELETE → writes só via RPC SECURITY DEFINER.
- **RPCs novas** `toggle_phone_ai(p_phone, p_disabled)` e `get_phone_ai_status(p_phone)`.
- **RPC existente** `toggle_lead_ai` ampliada: UPSERT em preferences além de leads.
- **RPC antiga** `toggle_conversation_ai` removida (DROP FUNCTION CASCADE).
- **Trigger** `sync_lead_ai_to_preferences` em leads AFTER UPDATE OF ai_disabled — rede de segurança se algum caminho externo bypassar as RPCs.
- **Ingestão** `getOrCreateLead` consulta `phone_ai_preferences` antes do INSERT; herança automática no nascimento do lead.
- **Frontend** novo hook `usePhoneAiStatus(phone)`; `useToggleConversationAI` reescrito com optimistic update e rollback; `useToggleLeadAI` ganha optimistic em `lead_ai_status` que antes estava faltando.

## Alternativas consideradas

| Alternativa | Rejeitada porque |
|---|---|
| Só adicionar `shadow_ai_toggle` ao enum `lead_origin` | Mantém shadow leads por toggle (uso impróprio da abstração), dispara triggers de leads desnecessariamente, não resolve duplicação ou normalização divergente |
| `ai_disabled` em `conversations` | Conversations é Copilot-específica, só existe após 1ª msg do agente. Mesmo problema do leads. |
| localStorage / cliente | Não cross-device, não acessível a webhook, viola multi-device |
| Tabela `contact_preferences` genérica | Over-engineering pra uma única preferência. Migrar depois se surgirem outras preferências por contato. |

## Consequências

### Positivas

- Fecha os 5 caminhos de inconsistência identificados na análise.
- Multi-tenant direto (PK composta + RLS).
- Normalização canônica única (SQL `normalize_brazilian_phone` + TS espelho testado por equivalência).
- Duplicatas de leads sincronizadas automaticamente (RPCs aplicam em todos leads com mesmo `normalized_phone`).
- Toggle antes da 1ª mensagem agora funciona (preferência persiste sem lead).
- Observabilidade: `lead_history` com entradas `ai_disabled`/`ai_reactivated` por lead afetado + metadata com `source_rpc`.

### Custos

- 2 writes por toggle (preferência + leads sincronizados). Aceitável — volume de toggles é baixo.
- Trigger defensiva adiciona ~1 UPSERT por UPDATE em leads.ai_disabled. Impacto desprezível (não dispara em INSERT, só quando flag realmente muda).

### Riscos residuais

- **R1** — Race condition entre toggle e webhook concorrente na mesma milissegundo. Mitigação: `getOrCreateLead` consulta preference ao criar lead, mesmo sob race ainda herda corretamente.
- **R2** — Se `normalized_phone IS NULL` no lead (migração antiga), toggle só atualiza aquele lead específico, não as duplicatas. Comportamento de fallback existente preservado.
- **R3** — Cancelamento de respostas IA já "em voo" não é escopo desta task — o gap entre gerar resposta e send Evolution continua existindo em `agent-message`. Mitigação de UX se preserva pela trigger e `getOrCreateLead` respeitando `ai_disabled` na criação do lead. **Resolver em task separada**: re-checar `ai_disabled` imediatamente antes do send via Evolution API.

## Referências

- Spec: `.specs/features/phone-ai-preferences/spec.md`
- Design: `.specs/features/phone-ai-preferences/design.md`
- Tasks: `.specs/features/phone-ai-preferences/tasks.md`
- Migrations:
  - `supabase/migrations/20260916000000_phone_ai_preferences_table.sql`
  - `supabase/migrations/20260916000001_phone_ai_preferences_rpcs.sql`
  - `supabase/migrations/20260916000002_leads_ai_sync_back_to_preferences.sql`
- Migration ancestral relacionada: `20260915000000_toggle_lead_ai_sync_duplicates.sql` (sync de duplicatas)
- Changelog: `Obsidian/.../07 — Changelog/2026-04-22.md`

## Links

- [[Chat WhatsApp]]
- [[Copilot]]
- [[WhatsApp Evolution]]
