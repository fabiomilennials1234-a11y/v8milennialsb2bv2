# 2026-07-13 — lead-webhook: origin_detail

**Branch:** `feat/lp-meta-origem-tag`

## O quê

- Migration `20270312000000_add_leads_origin_detail.sql`: coluna `leads.origin_detail text` (nullable).
- `lead-webhook` aceita `origin_detail` top-level no payload: trim + cap 120 chars, gravado em `leads.origin_detail`. Em reconversão (`update_existing_if_match=true`) sobrescreve o valor anterior — ex.: lead que agendou passa de "Cadastro LP Meta" pra "Agendamento Automático Meta".
- Notes default de lead novo passou de `Fonte: <source>` pra `Fonte: <origin_detail || source>`.
- `LeadSource.tsx` já exibia `lead.origin_detail` (a coluna não existia — erro no `.tsc-baseline.json`, resolve após regen de types).

## Por quê

Fluxo LPs Meta da Milennials (LP Acelerar, LP Nicolodi, LP VSL A, Bio Instagram): origem exigida ("Cadastro LP Meta" / "Agendamento Automático Meta") não cabe no enum `lead_origin`. `origin_detail` carrega o rótulo específico da captação sem poluir o enum.

## Testes

- `tests/unit/lead-webhook.test.ts`: +4 casos (`origin_detail` em lead novo, reconversão, blank ignorado, trim/cap 120).
- Corrigidos 2 testes obsoletos de Meta dummy que ainda esperavam o comportamento pré-discard (quebrados na main desde o incidente HGE; o comportamento atual é coberto por `lead-webhook-meta-dummy-discard.test.ts`).

## Deploy (pendente — manual)

1. Migration em dev/prod: `supabase db push --linked --project-ref <ref>` (prod só com autorização CTO).
2. `supabase functions deploy lead-webhook --project-ref <ref>`.
3. Regen types: `supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts`.

## Integração externa (fora deste repo)

Workflows n8n prontos pra importar nas pastas das LPs (`site3dmimi`, `nicolodi/lp-milennials-b2b`, `b2b-vsl`, `Milennials Digital`) — todos postam no `lead-webhook` prod com `organization_id` da Milennials, `origin_detail` + tag da LP e `place_in_pipe`. Agendamentos Cal.com entram por webhook Cal → n8n → `confirmacao/reuniao_marcada`. Runbook: `Desktop/CLAUDE/tarefa-fabio/INTEGRACAO-LPS-CRM.md`.
