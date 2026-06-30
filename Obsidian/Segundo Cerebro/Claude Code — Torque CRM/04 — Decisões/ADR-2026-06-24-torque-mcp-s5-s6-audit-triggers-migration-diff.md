---
type: adr
title: "torque-mcp S5/S6 — audit_triggers + migration.diff"
status: accepted
created: 2026-06-24
updated: 2026-06-24
tags: [adr, torque-mcp, observability, migrations, security, search-path]
related: ["[[ADR-2026-06-22-torque-mcp-interno]]"]
owner: gabriel
supersedes: []
superseded_by: []
---

# ADR-2026-06-24 — torque-mcp S5/S6: schema.audit_triggers + migration.diff

**Data:** 2026-06-24
**Status:** accepted
**Escopo:** `supabase/functions/torque-mcp/` — pack de diagnóstico (read-only). Extensão incremental do servidor MCP interno; **não** redefine a forma/auth do servidor.

> Decisão fundadora (forma Edge Function, auth master RLS-herdado, anti-bypass DEFINER, protocolo hand-roll JSON-RPC) vive em `docs/adr/0011-torque-mcp-internal-ops-server.md` e no vault em [[ADR-2026-06-22-torque-mcp-interno]]. Esta ADR registra **só** as duas tools de diagnóstico adicionadas em S5 e S6, e o porquê de cada uma fechar uma ferida concreta. Não há ADR dedicada no repo para S5/S6 — elas estendem a 0011.

## Contexto

O pack de diagnóstico aberto em S4 (`rls.check_access`, `schema.audit_definer`) cobria só parte da superfície de incidentes recorrentes. Duas feridas concretas ficaram fora:

1. **Ponto cego do `schema.audit_definer`.** A query da tool varre `pg_proc` com `prosecdef = true` — ou seja, **só** funções `SECURITY DEFINER`. Mas a classe de incidente `42883` ("function does not exist" por chamada unqualified sob `search_path` vazio) **não é exclusiva de DEFINER**: uma *trigger function* sem `SET search_path` próprio herda o `search_path` do statement que dispara o trigger. Quando um caller endurecido (uma RPC `SECURITY DEFINER` com `SET search_path = ''`, ex. `bulk_delete_leads`) dispara o trigger, qualquer nome unqualified falha. Foi exatamente assim que o outage de delete-de-lead ficou escondido: `leads_derive_uf_from_ddd()` (criado por `20261211100000_lead_uf_and_map`, non-definer, chamando `uf_from_ddd(...)` unqualified) só estourava sob `bulk_delete_leads` — invisível ao `audit_definer`, que nunca olha funções non-definer. Fix do outage: `20261224000000_fix_leads_uf_trigger_search_path.sql`. A lição: a varredura `prosecdef=true` é cega à classe inteira de triggers non-definer.

2. **Drift repo↔DB sem ferramenta.** A divergência entre as migrations *no repo* e o que está *aplicado no banco* (`supabase_migrations.schema_migrations`) é uma das classes de incidente mais recorrentes do projeto: mudanças out-of-band aplicadas direto em prod sem migration no repo, migrations no repo que nunca chegaram ao DB, e prefixos de versão duplicados que o `db push` **descarta silenciosamente** (auditados em `#822`/`#824`). A verificação era manual, sob pressão, não-auditada.

Não decidir agora prolonga o padrão "achado por acidente quando o path real é exercido" — o pior modo de descobrir um `42883` ou um fix crítico que nunca foi aplicado.

## Forças em jogo

**Restrições do CTO:**
- Toda diagnose precisa ser **read-only, auditada e repetível** — não script ad-hoc.
- Reusar a espinha existente do torque-mcp; nada de toolchain nova.

**Restrições técnicas:**
- A Edge Function **não tem filesystem do repo** — a verdade do repo precisa ser injetada pelo chamador.
- O substrato de leitura (`mcp_exec_readonly_sql`) roda com `search_path = pg_catalog, public`; qualquer leitura fora de `public` exige schema qualificado **e** grant explícito ao role `mcp_readonly`.
- Lógica precisa ser **função pura** → unit-testável em `deno test` local sem Docker.

**Restrições de segurança/multi-tenant:**
- Read-only role com hard wall sobre tabelas-segredo: qualquer grant novo precisa ser comprovadamente sem PII/segredo.

## Decisão

Adotadas as duas tools, ambas `readonly: true`, ambas sobre o substrato `mcp_exec_readonly_sql` (role `mcp_readonly`, master-gated).

### D1 — `schema.audit_triggers` (S5, `#873`)

Lista as *trigger functions* em `public` (`pg_proc` onde `prorettype = 'pg_catalog.trigger'::regtype`) e marca as que **não** pinam `search_path`. Reporta `attached_triggers` (contagem via `pg_trigger` com `not tgisinternal`) pra que triggers vivos se destaquem dos órfãos. Predicado de risco = `pins_search_path === false`. **Sem migration** — `pg_proc`/`pg_trigger` são PUBLIC-readable. Query-builder (`buildTriggerAuditQuery`) + predicado (`isTriggerRisk`) puros, unit-testados. Fecha literalmente o ponto cego do `schema.audit_definer`: este só varre `prosecdef=true`; aquele varre a classe trigger inteira, independente de DEFINER.
Arquivos: `supabase/functions/torque-mcp/tools/schema.ts` (+85), `tools/schema.test.ts` (+26), `index.ts`, `README.md`.

### D2 — `migration.diff` (S6, `#874`)

Compara as versões de migration do repo contra o ledger aplicado no DB. Como a fn não tem o filesystem do repo, o **chamador injeta a verdade do repo** via `repo_versions` (ex. `git ls-files supabase/migrations | grep -oE '[0-9]{14}'`); a tool injeta a verdade do DB lendo `supabase_migrations.schema_migrations`. Saída: `repo_not_applied` (pendentes/puladas), `applied_not_in_repo` (out-of-band), `repo_collisions` (prefixos duplicados, **contados antes do dedup** — duplicata é o sinal), e `in_sync`. `normalizeVersion` tolera caminhos completos e sufixos `_nome.sql`, reduzindo a 14 dígitos. Diff puro e determinístico (`diffMigrations`), unit-testado.

### D3 — grant estreito pro ledger (migration `20261230000000`)

`schema_migrations` vive **fora** de `public`, então `migration.diff` falharia com "permission denied for schema supabase_migrations". A migration `20261230000000_grant_mcp_readonly_schema_migrations.sql` concede `USAGE` no schema + `SELECT` na única tabela-ledger ao role `mcp_readonly`. Escopo deliberadamente mínimo: o ledger guarda só prefixos de versão e nomes de migration — **sem PII, sem segredo, sem credencial** — então não fura o hard wall do read-only role. Idempotente e guardado (no-op se role ou tabela ausentes, ex. DB fresco). Posicionada após `20261229000000` (sem colisão de versão).

## Consequências

### Positivas
- A classe `42883` (trigger non-definer sob caller endurecido) deixa de ser descoberta por acidente — `schema.audit_triggers` a varre proativamente. Smoke prod: 123 trigger functions, `unpinned_search_path = 0`.
- O drift repo↔DB vira uma chamada auditada e RLS-safe. Dogfood em dev expôs o estado real: **16 colisões** no repo, **180** `repo_not_applied`, **0** out-of-band, `in_sync = false` — i.e., há fix no repo possivelmente nunca aplicado (corrobora `#824`).
- Zero superfície de segurança nova: ambas read-only; a única migration concede leitura a um ledger sem segredo.

### Negativas
- `migration.diff` depende do chamador passar `repo_versions` corretos; comando errado → falso "out-of-band". Mitigação: descrição da tool documenta o `git ls-files` canônico.
- Mais um grant (por mais estreito que seja) amplia a superfície do `mcp_readonly` — aceitável dado o conteúdo não-sensível do ledger.

### Pendências geradas
- MEDIUM: agir sobre os achados do `migration.diff` em prod — confirmar se os ~180 `repo_not_applied` incluem fixes críticos nunca aplicados (cruzar com `#824` / `docs/meta-cloud-cert/MIGRATION-COLLISION-AUDIT.md`).
- LOW: CI guard contra prefixos de versão duplicados (a colisão que o `db push` engole), pra que `repo_collisions` tenda a zero por construção.

## Status de entrega

- S5 `#873` — merge `dd1dbfdb` (2026-06-23). 204 deno unit verde, lint/fmt limpos.
- S6 `#874` — merge `5f6023da` (2026-06-24). Suíte torque-mcp 103/103; 8 testes Deno puros; dogfood dev (grant + deploy + `tools/call` HTTP 200).
- Ambas **mergeadas + deployadas dev+prod**. Smoke prod: `schema.audit_triggers` → 123 trigger fns, `unpinned = 0`.

## Evidência

- `docs/adr/0011-torque-mcp-internal-ops-server.md` — decisão fundadora (forma/auth/anti-bypass). Vault: [[ADR-2026-06-22-torque-mcp-interno]].
- S5 `#873` (merge `dd1dbfdb`): `supabase/functions/torque-mcp/tools/schema.ts` (`buildTriggerAuditQuery`, `isTriggerRisk`, `schemaAuditTriggersTool`), `tools/schema.test.ts`.
- S6 `#874` (merge `5f6023da`): `supabase/functions/torque-mcp/tools/migration.ts` (`diffMigrations`, `normalizeVersion`, `buildAppliedMigrationsQuery`, `migrationDiffTool`), `tools/migration.test.ts`, `.specs/features/torque-mcp/s6-migration-diff.md`.
- Migration `supabase/migrations/20261230000000_grant_mcp_readonly_schema_migrations.sql`.
- Incidente que motivou S5: `supabase/migrations/20261224000000_fix_leads_uf_trigger_search_path.sql` (root cause `leads_derive_uf_from_ddd` de `20261211100000_lead_uf_and_map`; `42883`).
- Classes de drift de S6: auditadas em `#822` / `#824` (`db push` descarta versões colididas).
