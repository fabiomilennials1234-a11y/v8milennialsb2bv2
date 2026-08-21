# Runbook — ambiente de validação (BRANCH EFÊMERA de prod, canônico)

> Arquiteto (Cais) · 2026-07-27 (rev.3) · **Decisão CTO: nada de Docker; validar via branch efêmera forkada de prod.** Não validar direto em prod; não operar sem ambiente.
> **O perigo desta escolha:** sem local, o caminho é `db push --db-url <branch>` e uma URL errada escreve em prod (foi o acidente do dia). Por isso a defesa aqui é **MECÂNICA, não disciplina.**

## 1. Guardas MECÂNICAS (o coração — sem elas, não opere)

### 1a. Checkout NUNCA linkado (1ª linha, permanente)
Estado permanente do repo de trabalho: **não-linkado**. Provado: `supabase db push` bare → `Cannot find project ref. Have you run supabase link?`. `.temp/` é gitignored; o link é sempre ato deliberado e temporário, desfeito ao fim.

### 1b. Wrapper que RECUSA o ref de prod — `scripts/db-push-branch.sh`
Nunca rodar `db push --db-url` na mão. Sempre pelo wrapper, que:
1. **Aborta se a URL/ref contiver `jsjsmuncfkbsbzqzqhfq`** (ref de prod = impossível por acidente, não "proibido por convenção").
2. Roda `--dry-run` primeiro, imprime a lista de migrations, **exige confirmação explícita**.
3. **Checagem por efeito:** push em branch NOVA deve reportar backfill **"0 org"**. Se **"1 org promovida" → tocou dado real → ABORTA e investiga** (branch impura ou URL de prod).

Esqueleto:
```bash
#!/usr/bin/env bash
set -euo pipefail
URL="${1:?uso: db-push-branch.sh <db-url-da-branch>}"
PROD_REF="jsjsmuncfkbsbzqzqhfq"
[[ "$URL" == *"$PROD_REF"* ]] && { echo "ABORT: URL contém o ref de PROD ($PROD_REF). Isto é uma branch efêmera, não prod."; exit 1; }
echo "== dry-run =="; supabase db push --db-url "$URL" --dry-run
read -r -p "Aplicar as migrations acima nesta branch? (digite APLICAR) " ok; [[ "$ok" == "APLICAR" ]] || { echo "cancelado"; exit 1; }
OUT=$(supabase db push --db-url "$URL" 2>&1); echo "$OUT"
echo "$OUT" | grep -qiE '1 org (promovida|promoted)' && { echo "ABORT: push reportou org promovida — tocou DADO REAL. Investigar."; exit 2; } || true
```

### 1c. Guarda do MCP — separar por FERRAMENTA
`read_only=true` é do servidor inteiro (bloquearia escrita na branch também). Então **não** é "MCP faz tudo": separa por ferramenta.

| Caminho | Uso | Guarda |
|---|---|---|
| **MCP** | só leitura (medir prod, conferir) + `create_branch`/`list_branches`/`delete_branch` | `read_only=true` |
| **`psql`/CLI `--db-url`** | TODA escrita, sempre em branch | wrapper (§1b) |

Provado nos docs: **`create_branch` sobrevive** (Branching = Management API, separado do role Postgres do `read_only`); **`apply_migration` cai no read_only** (grupo Database, DDL como role → negado — porta fechada, e não usamos: DDL da branch vem por `db push`/wrapper). Escrita de QA = script `psql` versionado (§2b), não chamada MCP → reproduzível. **Ligar `read_only` = passo do CTO.**

### 1d. `config.toml project_id` = ref de prod, commitado → trocar por neutro
`supabase/config.toml:1` = `project_id = "jsjsmuncfkbsbzqzqhfq"` = default de qualquer clone. É o id do CLI (nomeia o stack + ref canônico); a autoridade remota é o LINK (`.temp/`, gitignored), `db push` não cai nele (provado), deploy usa `--project-ref` (CLAUDE.md:78). Mas é segundo-caminho latente + default confuso. **Trocar por `torque-crm-local`** (chore) — risco baixo, remove o último ref de prod do default commitado.

## 2. Ciclo de vida da branch (quem cria, mata)
1. `list_branches` **antes** de criar — **nunca duas** (pode haver uma esquecida).
2. `create_branch` (fork de prod).
3. `scripts/db-push-branch.sh <url-da-branch>` — aplica as migrations do repo na branch.
4. `bash supabase/tests/run.sh` contra a branch.
5. `delete_branch` **obrigatório** ao fim. **A branch não sobrevive entre sessões** (custo $0.01344/h; órfã = cobrança).

## 2b. Seed da branch — `supabase/qa-seed/` (versionado, reproduzível)
A branch forka o **schema** de prod (replay de migrations), **não os dados de QA** → sobe sem o que exercitar. E `seed.sql` **não serve** aqui (só roda em `db reset` local, que não existe). Então o seed de QA vive em **`supabase/qa-seed/*.sql`** — scripts `psql` versionados, aplicados à branch após o `db push`:
```bash
psql "$BRANCH_URL" -f supabase/qa-seed/00_orgs.sql -f supabase/qa-seed/10_dashboard.sql ...
```
Faz o exercício ser **re-executável por outra pessoa** (o do dedup hoje não é). Vizinho natural da F4 (a taxonomia de "onde mora cada tipo de escrita de dado"): migration=schema · backfill de prod=fn+invocação deliberada · seed de ambiente local=`seed.sql` · **seed de QA na branch=`supabase/qa-seed/`**.

## 3. O que a branch NÃO resolve sozinha
- **Marcador do baseline:** `create_branch` replaya o ledger de prod, onde o baseline é **marcador de 189 chars** → branch nasce com schema incompleto; por isso o `db push` do repo (passo 3) aplica o baseline real. É o custo do 1.8 MB por branch.
- **Cron/pg_net/Realtime wire-level:** cobertos numa branch de prod (ao contrário do local), mas cron precisa ser semeado à parte se o teste depender.

## 4. Regra de migration (F4 — sobe de prioridade)
Sem local, todo push roda os `DO` block. Migration = **só schema**: se não escreve dado de cliente, uma URL errada vira **erro de schema recuperável**, não mudança de dado. Backfill de prod = fn + invocação deliberada (backup+idempotência); seed de ambiente = `supabase/seed.sql`. Lint barra `INSERT/UPDATE/DELETE` de tabela de cliente no `DO`/apply.

## Apêndice — validação LOCAL (se um dia houver Docker)
`supabase start && db reset && run.sh` replaya o **arquivo** baseline real do zero (schema idêntico a prod, provado #1233), $0, **sem caminho físico pra prod** — é mais seguro que branch-de-prod. Reintroduzir como canônico se/quando Docker voltar à mesa. Até lá, branch efêmera é o oficial.
