# Implementation Spec — Torque MCP S6: `migration.diff`

> **Branch:** `feat/torque-mcp/s6-migration-diff` · **ADR:** `docs/adr/0011` · **Criado:** 2026-06-24
> **Fonte de verdade da feature:** ADR 0011 + `supabase/functions/torque-mcp/README.md` + `./tasks.md`.
> Este doc é o spec de **uma slice** (read-only tool nova). Segue o pattern das tools S4/S5
> (`tools/schema.ts`): builder puro + predicado puro testáveis, handler fino sobre
> `mcp_exec_readonly_sql`.

---

## 1. Problema

Drift entre as migrations **no repo** e o que está **aplicado no banco** (`schema_migrations`)
é a classe de incidente mais recorrente do projeto. Casos vivos na memória:

- **Out-of-band em prod sem migration no repo** — ex. `org_get_subscription_status` ganhou
  `assert_org_access` direto em prod (2026-06-09); reaplicar o repo **removeria** o guard.
- **Migration no repo nunca aplicada** — 20 migrations colidiram em versão e o `db push` pulou
  os losers; 5 fixes críticos (dataloss + segurança) provavelmente **nunca foram a prod** (#824).
- **Colisão de prefixo de versão no repo** — dois arquivos com o mesmo `YYYYMMDDHHMMSS`;
  `db push` aplica um e descarta o outro silenciosamente (#822/#824; CI guard #826 cobre só
  repo-vs-repo, não repo-vs-DB).

Hoje detectar isso é manual (puxar `schema_migrations` na mão via Management API + comparar
de olho). `migration.diff` torna a verificação uma chamada única, auditada, RLS-segura — e
fecha o loop com o item de roadmap "migration.diff_prod" do `tasks.md`.

## 2. Contrato da tool

```
name: "migration.diff"   readonly: true   (visível mesmo com mutations OFF)
```

**Input** (`inputSchema`):
| campo | tipo | obrig. | descrição |
|---|---|---|---|
| `repo_versions` | `string[]` | sim | Prefixos de versão das migrations do repo. O caller (Claude) gera com `git ls-files supabase/migrations \| grep -oE '^.*/[0-9]{14}'` → só os 14 dígitos. Duplicatas **preservadas** (são o sinal de colisão). |
| `include_applied` | `boolean` | não | Também devolver a lista completa de versões aplicadas no DB (default `false`: só o diff). |

> O contrato é **stateless quanto ao repo**: a edge function não tem filesystem do repo.
> O caller injeta a verdade do repo; a tool injeta a verdade do banco (o banco onde a função
> está deployada — prod ou dev). Diff = comparação dos dois conjuntos.

**Output** (`content[0].text` = JSON):
```jsonc
{
  "db_applied_count": 322,
  "repo_count": 324,
  "repo_not_applied": ["20261216000000", "20261217000000"], // no repo, ausentes no DB → pendentes/pulados
  "applied_not_in_repo": ["20260601120000"],                 // no DB, ausentes no repo → out-of-band/drift
  "repo_collisions": [                                        // prefixo duplicado no repo
    { "version": "20261118000000", "count": 2 }
  ],
  "in_sync": false,
  "applied": ["..."]   // só se include_applied=true
}
```

Cada chave mapeia 1:1 numa classe de bug acima. `in_sync = true` ⟺ os três arrays vazios.

## 3. Design (3 peças, espelha `schema.ts`)

### 3a. Lógica pura — `diffMigrations(repoVersions, dbVersions)`
Arquivo: `supabase/functions/torque-mcp/tools/migration.ts`. Função pura, sem I/O:

```ts
export interface MigrationDiff {
  repo_not_applied: string[];
  applied_not_in_repo: string[];
  repo_collisions: Array<{ version: string; count: number }>;
  in_sync: boolean;
}
export function diffMigrations(repoVersions: string[], dbVersions: string[]): MigrationDiff
```

Regras:
- Normalizar cada entrada para os **14 primeiros dígitos** (`v.replace(/\D/g,'').slice(0,14)`);
  descartar entradas que não batam `^\d{14}$` (defensivo contra lixo do `git ls-files`).
- `repo_not_applied` = `unique(repo) \ set(db)`, ordenado asc.
- `applied_not_in_repo` = `set(db) \ set(repo)`, ordenado asc.
- `repo_collisions` = versões com `count > 1` no array do repo (contagem **antes** de dedup).
- `in_sync` = os três vazios.
- Determinístico: sempre ordenar saídas asc (sem `Date`/`Math.random`).

### 3b. Query — `buildAppliedMigrationsQuery()`
```sql
select version
from supabase_migrations.schema_migrations
order by version
```
Roda por `mcp_exec_readonly_sql` (role `mcp_readonly`, master-gated, READ ONLY txn).
**Qualificar o schema** (`supabase_migrations.`) é obrigatório — o `search_path` do RPC é
`pg_catalog, public`, então `schema_migrations` não-qualificado não resolve.

### 3c. Handler — `migrationDiffTool: ToolDef`
- Lê `repo_versions` do input (validar: array de strings, senão `isError`).
- `db.rpc("mcp_exec_readonly_sql", { p_sql: buildAppliedMigrationsQuery(), p_max_rows: 5000 })`.
- Extrai `version` de cada row; chama `diffMigrations`; monta payload; `include_applied` anexa `applied`.
- Erro do RPC → `{ isError: true, content: [{ text: "Error: ..." }] }` (mesmo shape das outras).
- Registrar em `index.ts` no array `TOOLS`.

## 4. Pré-requisito de DB (migration nova) — **bloqueante**

`mcp_readonly` só tem `USAGE`/`SELECT` em `public` (ver `20261226000000`). A tabela
`supabase_migrations.schema_migrations` está fora → a query falha com permission denied sem isto.

Migration `supabase/migrations/<novo_ts>_grant_mcp_readonly_schema_migrations.sql`:
```sql
GRANT USAGE ON SCHEMA supabase_migrations TO mcp_readonly;
GRANT SELECT ON supabase_migrations.schema_migrations TO mcp_readonly;
```
- Idempotente (GRANT é repetível).
- Sem PII / sem segredo (só versões + nomes de migration) → não viola o hard-wall de secrets.
- `version` é prefixo de timestamp; nenhuma das colunas é sensível.
- **Atenção ao timestamp** do arquivo: rodar contra o repo + contra prod via `migration.diff`
  (dogfood) antes de fechar, pra não introduzir uma colisão de versão na própria slice.

## 5. Plano TDD (red → green)

Arquivo: `supabase/functions/torque-mcp/tools/migration.test.ts` (Deno, puro — sem DB).
Casos sobre `diffMigrations`:
1. **in_sync** — repo e db idênticos → 3 arrays vazios, `in_sync:true`.
2. **repo_not_applied** — repo tem 2 versões a mais → aparecem ordenadas; resto vazio.
3. **applied_not_in_repo** (drift out-of-band) — db tem 1 versão a mais → aparece.
4. **repo_collisions** — repo com prefixo duplicado → `{version,count:2}`; e a versão ainda
   classifica certo em applied/not-applied.
5. **normalização** — entradas com path completo / sufixo `_nome.sql` → reduzidas a 14 dígitos;
   lixo não-`\d{14}` descartado.
6. **determinismo** — entrada embaralhada → saída idêntica e ordenada.

Não mockar o RPC (lição da memória: mock-da-resposta-inteira = confiança falsa). A propriedade
DB fica coberta pelo dogfood do passo 4 + smoke pós-deploy, não por mock.

## 6. Critérios de aceite

- [ ] `diffMigrations` com ≥6 testes Deno verdes; lint 0; `index.ts` type-check ok.
- [ ] `migration.diff` registrada e visível em `tools/list` (readonly, aparece com mutations OFF).
- [ ] Migration de grant aplicada em **dev**; `migration.diff` contra dev retorna sem permission error.
- [ ] Dogfood: rodar contra **prod** (autorização CTO) e contra repo → relatório real do drift atual
      (esperado: expõe os pendentes do #824 se ainda não aplicados).
- [ ] README §"Diagnostic pack" ganha entrada da tool; `tasks.md` move "migration.diff_prod" p/ Feito.
- [ ] ADR 0011 inalterado (não muda arquitetura; é mais uma read-tool sob o mesmo contrato).

## 7. Fora de escopo

- Diff de **schema** (colunas/índices/policies) — isto compara só o **ledger de migrations**.
  Drift de objeto fica pra `schema.diff` futura.
- Aplicar / reordenar / re-timestampar migrations (mutating) — `migration.diff` só **reporta**.
- Substituir o CI guard de colisão (#826): aquele é repo-vs-repo em PR; esta tool é repo-vs-DB
  sob demanda. Complementares.
- Cenário B (customer-facing).

## 8. Sequência de execução

1. `migration.ts` (puro) + `migration.test.ts` — red→green.
2. Handler + registro em `index.ts`.
3. Migration de grant (timestamp checado contra repo).
4. Deploy dev + aplicar grant dev + smoke (`tools/call migration.diff`).
5. Dogfood prod (autorização CTO) → anexar relatório no PR.
6. Docs (README + tasks.md). PR `feat/torque-mcp/s6-migration-diff` → main (arquiteto commita/pusha).
