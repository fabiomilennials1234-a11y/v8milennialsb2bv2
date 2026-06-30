---
type: changelog
title: 2026-06-24 — torque-mcp S5 (schema.audit_triggers) + S6 (migration.diff) + crm-mcp C1 spine
status: shipped
created: 2026-06-24
updated: 2026-06-24
tags: [torque-mcp, crm-mcp, mcp, seguranca, migrations, observabilidade]
related: ["[[ADR-2026-06-22-torque-mcp-interno]]", "[[2026-06-25]]"]
owner: gabriel
---

# 2026-06-24 — torque-mcp S5 (schema.audit_triggers) + S6 (migration.diff) + crm-mcp C1 spine

Três entregas do programa MCP interno, agrupadas: duas tools novas de diagnóstico no `torque-mcp` (S5, S6) e a extração da espinha agnóstica de auth pro `_shared/mcp/` (crm-mcp C1), que destrava o servidor MCP customer-facing.

## Mudanças

- **torque-mcp S5 — `schema.audit_triggers`** (PR #873, `dd1dbfdb`): nova tool que lista **trigger functions** de `public` e sinaliza as que **não pinam `search_path`**. Fecha o ponto cego do `schema.audit_definer`, que só varre `prosecdef=true` (SECURITY DEFINER) e por isso **perdia triggers non-definer** — exatamente como o outage `leads_uf` 42883 ficou escondido até o caminho real de delete ser exercitado. Uma trigger sem `search_path` pinado resolve nomes não-qualificados contra o `search_path` do statement que dispara; sob um caller endurecido (RPC SECURITY DEFINER com `SET search_path = ''`, ex. `bulk_delete_leads`) qualquer referência não-qualificada explode. Reporta `attached_triggers` por função pra distinguir as vivas das mortas. Mesma substância read-only (`mcp_exec_readonly_sql`, role `mcp_readonly`, master-gated), **sem migration**.
- **torque-mcp S6 — `migration.diff`** (PR #874, `5f6023da`): nova tool que compara o **ledger de migrations do repo** (verdade injetada pelo caller — a edge function não tem filesystem do repo) contra o **aplicado no DB** (`supabase_migrations.schema_migrations`). Devolve `repo_not_applied`, `applied_not_in_repo` (drift out-of-band), `repo_collisions` (prefixos de versão duplicados, contados **antes** do dedup) e `in_sync`. Transforma a classe de incidente mais recorrente do projeto (migrations que nunca chegaram no DB, mudanças out-of-band, colisões que o `db push` dropa em silêncio — vide #822/#824) numa chamada única, auditada e RLS-safe. `diffMigrations` é puro/determinístico (saídas ordenadas, sem clock). Dogfood em **dev**: grant aplicado + deploy + `tools/call` HTTP 200, revelando **16 colisões reais no repo** (verificável no filesystem) + drift repo↔DB (`in_sync=false`); as contagens de `repo_not_applied`/`out-of-band` são snapshot de runtime contra o DB de dev (não deriváveis do repo).
- **crm-mcp C1 — espinha agnóstica de auth** (PR #878, `1178a034`): extração dos **8 módulos** de infra do MCP (15 arquivos com os testes) de `torque-mcp/lib/` → `_shared/mcp/` (auth, crypto, dispatch, guardrails, http, redact, registry, types — todos com `.test.ts` exceto `types`). Renames puros (sem mudança de comportamento) + repoint de imports nos **13 arquivos** de `torque-mcp/` que consumiam a espinha. Isso permite que um segundo servidor MCP — o **crm-mcp customer-facing (cenário B, BYO-AI, RLS-puro per-user)** — reaproveite a mesma fundação sem fork. DESIGN.md formalizado em PR #879 (`dea5794f`, 742 linhas; cenário B, RLS-pura per-user, decisões D1–D12).

## Arquivos tocados

- `supabase/functions/torque-mcp/tools/schema.ts` — `buildTriggerAuditQuery()`, predicado `isTriggerRisk()`, `schemaAuditTriggersTool` (S5, +85L).
- `supabase/functions/torque-mcp/tools/schema.test.ts` — +26L cobrindo query-builder + predicado (S5).
- `supabase/functions/torque-mcp/tools/migration.ts` — `diffMigrations()`, `normalizeVersions()` (prefixo 14 dígitos), `buildAppliedMigrationsQuery()`, `migrationDiffTool` (S6, +158L).
- `supabase/functions/torque-mcp/tools/migration.test.ts` — +86L, 8 testes Deno puros (S6).
- `supabase/functions/torque-mcp/index.ts` — registro das duas tools novas (S5 + S6).
- `supabase/functions/torque-mcp/README.md` — doc das tools.
- `supabase/migrations/20261230000000_grant_mcp_readonly_schema_migrations.sql` — **novo** (S6). `GRANT USAGE` no schema `supabase_migrations` + `SELECT` só na tabela `schema_migrations` pro role `mcp_readonly` (o ledger vive fora de `public`; sem o grant a leitura dá "permission denied"). Escopo deliberadamente estreito — sem PII/segredo/credencial; idempotente e guardado (no-op se role/tabela ausentes).
- `.specs/features/torque-mcp/s6-migration-diff.md` + `tasks.md` — spec da S6.
- `supabase/functions/_shared/mcp/{auth,crypto,dispatch,guardrails,http,redact,registry,types}.ts` (+ `.test.ts`) — **movidos** de `torque-mcp/lib/` (C1).
- `supabase/functions/torque-mcp/{index,lib/audit,lib/clients,tools/*}.ts` — repoint de imports pra `../../_shared/mcp/` (C1, 13 arquivos).
- `.specs/features/crm-mcp/DESIGN.md` — **novo** (PR #879, 742L), design do servidor customer-facing.

## Decisões

- **`audit_triggers` separado de `audit_definer`**: as duas classes de risco de `search_path` não se sobrepõem (definer vs trigger non-definer). Em vez de inchar uma tool, S5 cobre o gap exato que o outage `leads_uf` expôs — `attached_triggers>0` marca o que importa.
- **`migration.diff` stateless quanto ao repo**: a edge function não tem o filesystem do repo, então o caller injeta `repo_versions` (de `git ls-files`) e a tool injeta a verdade do DB. Colisões contadas antes do dedup de propósito — duplicata é o sinal, não ruído.
- **Espinha em `_shared/mcp/` antes de escrever o crm-mcp**: extrair primeiro (C1, rename puro) mantém o `torque-mcp` verde e dá ao crm-mcp uma fundação compartilhada sem duplicar auth/crypto/dispatch. O merge `13a0ec34` integrou o #874 (`migration.ts`) na branch da C1, repontando o novo tool pra espinha movida — integração pura, 103 testes passando.

## Follow-ups

- Resolver o drift que o S6 revelou em dev: **16 colisões reais + os `repo_not_applied` que o S6 listou em dev** — auditar quais são reais (pendentes) vs já aplicadas out-of-band sob outro prefixo, e bater contra prod.
- Rodar `schema.audit_triggers` em **prod** e confirmar `unpinned_search_path` nas trigger functions vivas (a classe 42883 é mais ampla que a do `audit_definer`).
- Avançar crm-mcp **C2** (infra de PAT + client RLS-scoped per-user + tracer `lead.get`) sobre a espinha — ver [[2026-06-25]].
