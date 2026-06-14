# Plano — API REST pública de Leads (P1 leitura + P2 escrita)

Decisões em [ADR-0008](../../../docs/adr/0008-public-rest-api-leads.md). Gap em [api-gap-analysis](../../api-gap-analysis-2026-06.md).

## Superfície final

```
# P1 — leitura (scope lead:read / pipeline:read / metadata:read)
GET    /api/v1/leads?stage=&tier=&tag=&origin=&responsible_id=&created_from=&created_to=&q=&limit=&cursor=
GET    /api/v1/leads/{id}                 # lead 360: tier, tags, custom fields, pré-vendas/closer,
                                          #           posições em pipes (embed vendido/valor)
GET    /api/v1/leads/{id}/timeline        # reusa get-lead-timeline
GET    /api/v1/pipelines                  # + stages config
GET    /api/v1/tags                       # catálogo
GET    /api/v1/custom-fields              # catálogo (lead_custom_fields)

# P2 — escrita (scope lead:write) — TUDO via action-handlers
PATCH  /api/v1/leads/{id}                 # nome/empresa/email/telefone/segmento/faturamento/
                                          #   urgência/notas/rating/tier/pré-vendas/closer
POST   /api/v1/leads/{id}/stage           # { pipe, stage, meeting_date? } via moveStage
POST   /api/v1/leads/{id}/tags            # { tags: [...] } (cria inexistentes)
DELETE /api/v1/leads/{id}/tags/{tag}
PUT    /api/v1/leads/{id}/custom-fields   # { "<field_name>": valor, ... }
```

Envelope listas: `{ data, next_cursor, has_more }`. Erro: `{ error: { code, message, details? } }`.

## Invariantes (não-negociáveis)

- **org-scoping manual fail-closed**: router roda service_role; resolve `organization_id` da API Key (SHA-256 → `api_keys`) e injeta em TODA query. Nunca confiar em RLS sozinha nesse caminho.
- **escrita só via action-handlers** (`moveStage`, `lead-field-operations`, `pipeline-adapter`) — dispara workflows/meeting_events/auto-Orçamentos igual UI.
- **scope check por rota** antes de executar (403 `insufficient_scope`).
- **cursor keyset** em `(created_at, id)`, opaco base64.
- webhook de saída marca `source` pra integrador quebrar loop.

## Fases / fatias verticais (tracer-bullet)

### Fatia 0 — Router + auth (fundação)
- Edge function `api` (router path-based `/api/v1/*`), parse de método+path, dispatch.
- Middleware: resolve API Key → org + scopes; rate-limit (reusa `rate_limits`); CORS+security headers; envelope de erro.
- Rota smoke `GET /api/v1/ping` (sem scope) pra provar o caminho end-to-end.
- Novos scopes no vocabulário + UI de API Keys aceitando-os.

### Fatia 1 — GET /leads (cursor + filtros) [P1]
- RPC `api_list_leads(p_org, filtros, p_limit, p_cursor)` retornando page + next_cursor. Reusa lógica de tier efetivo / posição em pipe.
- Allowlist de filtros server-side. Testes integração contra prod (org fixture).

### Fatia 2 — GET /leads/{id} + /timeline + catálogos [P1]
- `api_get_lead` (lead 360 com embeds). `/timeline` encapsula get-lead-timeline. `/pipelines`, `/tags`, `/custom-fields`.

### Fatia 3 — PATCH /leads/{id} [P2]
- Mapeia campos permitidos → `lead-field-operations`. Valida tier enum, FKs de responsável. Dispara automações.

### Fatia 4 — POST /leads/{id}/stage [P2]
- Encapsula `moveStage` (pipe+stage+meeting_date). Cobre caso `compareceu` → Orçamentos + meeting_held.

### Fatia 5 — tags + custom-fields [P2]
- POST/DELETE tags (cria inexistentes), PUT custom-fields (auto-cria campo? decidir: NÃO no v1, só setar valor de campo existente; 422 se não existe).

### Fatia 6 — Documentação + DX
- Adiciona os endpoints em `src/lib/api-docs/endpoints.ts` (mesma fonte que vira PDF/UI).
- Gera OpenAPI 3 + Postman a partir do `endpoints.ts`. Publica `llms.txt`.
- Atualiza PDF de referência.

## Aberto p/ decidir na implementação
- PUT custom-fields: auto-criar campo inexistente (como o ingest faz) vs 422. Proposta: 422 no v1 (escrita explícita ≠ ingest).
- Rate limit por scope vs global. Proposta: global por key (reusa o de hoje) no v1.
- Versionar embeds do lead 360 (campo `?include=`) — adiar; embed fixo no v1.
