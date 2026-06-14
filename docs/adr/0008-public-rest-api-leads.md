# Public REST API for Leads (read + write)

**Status:** accepted (2026-06-14)

## Context

The public API hoje é ingestão-first: ~8 edge functions estilo `/functions/v1/<nome>`, quase só criação de lead via webhook, sem leitura nem CRUD. Análise vs Kommo/RD Station/Clint (`.specs/api-gap-analysis-2026-06.md`) mostrou que o gap estrutural é não deixar o integrador **ler** nem **alterar** o CRM. Decidimos construir uma API REST de leitura (P1) + escrita (P2) lead-cêntrica.

## Decisões

1. **Shape REST limpo `/api/v1/*`** servido por uma única edge function roteadora (path-based), não uma edge function por recurso. URLs estáveis que o parceiro grava no código; domínio próprio (`api.torquecrm.com.br`) vem depois via rewrite sem quebrar o parceiro. Rejeitado: `/functions/v1/list-leads` (não-REST, feio, difícil de documentar como API).

2. **Lead-cêntrico.** Recursos: `leads`, `leads/{id}`, `leads/{id}/timeline`, `pipelines` (+stages), `tags`, `custom-fields`. **NÃO** expomos as tabelas `deals`/`contacts`/`companies` (wave1) — estão vazias em prod (0 linhas) e não são o modelo de domínio. O conceito "deal" do Kommo/RD mapeia para Lead + sua posição em Orçamentos (embedada na resposta do lead: vendido/valor).

3. **Paginação cursor/keyset** (não offset). A tabela `leads` tem 17k+ e muta constantemente; offset pula/duplica sob inserção e fica lento. Resposta `{ data, next_cursor, has_more }`. Catálogos pequenos (pipelines, tags) sem paginação.

4. **Filtros flat allowlisted** (`?stage=&tier=&tag=&origin=&responsible_id=&created_from/to=&q=`), multi-valor por vírgula. Sem RDQL/filter[] no v1. Custom-field como filtro fica fora do v1 (EAV).

5. **Escrita reusa a camada `action-handlers`** (`moveStage`, `lead-field-operations`, `pipeline-adapter`), nunca UPDATE cru. Garante que mover etapa via API dispara workflows, grava `meeting_events`, auto-cria Orçamentos ao chegar em `compareceu` — mesmas invariantes da UI (ADR-0004/0007).

6. **Escritas via API disparam todas as automações** (cidadão de 1ª classe, igual UI). Loop (API→workflow→webhook saída→integrador→API) mitigado pelo campo `source` no payload do webhook de saída + dedup de trigger já existente (`workflow-trigger-dedup`). Rejeitado: silêncio por default (quebraria invariantes do funil merged).

7. **Scopes resource:action pragmáticos**: `lead:read`, `lead:write` (PATCH+stage+tags+custom), `pipeline:read`, `metadata:read`, `lead:ingest`, `webhook:read`. Estende `api_keys.scopes` (já existe). Chaves antigas com `lead:write` permanecem superset (ingest+update) — backward-compat.

8. **Formato de erro** `{ error: { code, message, details? } }` + HTTP status correto + `Retry-After` em 429. `code` é string estável programável. Listas retornam `{ data, next_cursor, has_more }`; recurso único retorna o objeto direto.

## Consequências

- Auth continua **API Key estática escopada** (sem OAuth — adiado pro P3, só se houver marketplace de apps de terceiros).
- Sem `Idempotency-Key` no v1: as escritas do core são idempotentes por natureza (PATCH, stage upsert, tag add/remove, custom PUT).
- Sem feature-flag de rollout: acesso é por existência de API Key + scope, opt-in por org.
- Multi-tenant: a edge function roda como service_role e **filtra `organization_id` manualmente** a partir da key (fail-closed) — RLS não protege sozinha nesse caminho. Crítico para auditoria.
