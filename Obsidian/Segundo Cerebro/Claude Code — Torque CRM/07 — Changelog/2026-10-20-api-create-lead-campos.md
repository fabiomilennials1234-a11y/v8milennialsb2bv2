---
type: changelog
title: API pública — POST /leads grava o corpo que aceita e recusa o resto
status: in-progress
created: 2026-10-20
updated: 2026-10-20
tags: [changelog, api, leads, supabase, bug, seguranca]
related: []
owner: claude-agent
---

# 2026-10-20 — POST /api/v1/leads grava o corpo que aceita

Contexto: `POST /api/v1/leads` respondia 201 e a RPC `public.api_create_lead`
gravava só name/phone/email/company/origin — notes, segmento, faturamento e UTM
sumiam em silêncio. Nenhum chamador medido perdia dado (Make faz POST+PATCH; n8n
manda só as 5 chaves), mas integrador novo perderia.

## Mudanças
- **Criação grava 13 campos** na mesma chamada: name, phone, email, company, origin, notes, segment, faturamento, utm_source/medium/campaign/content/term. Lista em `CREATE_FIELDS` (handler) espelhada no INSERT da RPC.
- **Chave fora da lista → 422 `unknown_fields`** (`details.fields` ordenados + `details.hint`): responsáveis/tier/score apontam para PATCH; o resto para PUT custom-fields. RPC não é chamada.
- **Valor objeto/array/booleano → 422 `invalid_value`** (`details.field`); número vira texto; `name` ausente/em branco → 422 `missing_name` (antes 23502 → 500).
- **Handler repassa só o objeto filtrado**, nunca o corpo.
- **409 não altera o Lead existente**; `details.reason` = `phone_already_exists` ou `idempotency_key_reused`.
- **Idempotência com `request_hash`** (sha256 dos 13 campos normalizados): mesma chave + corpo diferente → 409 `lead_already_exists` com reason (não `idempotency_key_conflict`, para não quebrar os fluxos do n8n); hash NULL (chaves antigas) → replay como antes; advisory lock por (org, endpoint, chave); replay filtra `organization_id`; chave morta (Lead apagado) passa a apontar para o Lead novo.
- Migration `20271209000000_api_create_lead_campos.sql` **não aplicada** em lugar nenhum.

## Arquivos tocados
- `supabase/migrations/20271209000000_api_create_lead_campos.sql` — RPC nova + ACL + comment
- `supabase/migrations/rollback/20271209000000_api_create_lead_campos.sql` — volta ao corpo da 20271207
- `supabase/functions/_shared/api/routes/leads-create.ts` — `CREATE_FIELDS`, validação, reason no 409
- `public/api/openapi.json`, `public/api/llms.txt`, `src/lib/api-docs/rest-api-endpoints.ts` — contrato documentado
- Testes: `leads-create.test.ts`, `api/openapi-parity.test.ts`, `tests/integration/api-create-lead-campos.test.mjs` (PGlite, migration real)

## Decisões
- 409 com `reason` em vez de código novo — n8n trata `lead_already_exists`.
- Responsáveis/tier/score fora da criação: a validação deles mora no PATCH.

## Follow-ups
- Aplicar a migration em prod e deployar a edge function `api` (humano).
- Rollback exige reverter o handler ANTES da RPC.
