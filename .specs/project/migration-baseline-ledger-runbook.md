# Runbook — Reconciliação do ledger de migrations em PROD (Opção A / variante A2)

**Status: RUNBOOK PRONTO. PR baseline aberto (#1233, draft). Execução do ledger aguarda merge do CTO + re-aprovação do Crivo.**

Alvo: `jsjsmuncfkbsbzqzqhfq` (produção) · Autor: arquiteto (Cais) · Data: 2026-07-23

**Decisão CTO (2026-07-23):** sequência COMPLETA + rota **CLI** (`migration repair`, com senha do CTO).
Prod = `!` no terminal do CTO, guiado. Variante **A2**: renomear os 6 arquivos de métricas para as versões
reais do ledger (feito no PR #1233) e **manter** as 6 linhas do ledger; reverter só as **655 antigas**.

**Veredito Crivo (volta 1):** REPROVA execução até (a) `pg_dump` full-fidelity capturado, (b) baseline em
origin/main. Exigências acatadas: rota CLI (não MCP); guarda por **md5** (não count); snapshots em `.gitignore`.

---

## 0. Caminho de acesso (passo 0)

| Ferramenta | Ambiente dos agentes | Alcança prod? |
|---|---|---|
| **MCP Supabase** | token no server MCP | SIM read+write (usado só p/ snapshot/verify, **não** p/ mutação — Crivo exigiu CLI) |
| **supabase CLI** | linkado a `jsjsmuncfkbsbzqzqhfq`; **sem DB password, sem access-token** | precisa CTO (`-p` / `supabase login`) |
| **psql / pg_dump** v16 | instalados; `pooler-url` sem senha | precisa CTO (senha) |

**Único caminho para a mutação destrutiva = CLI com credencial do CTO.**

---

## 1. Snapshot (passo a) — FEITO E VERIFICADO (via MCP, read-only)

- `ledger_prod_backup_20260723.txt` — 661 linhas `version|name` (gitignored).
- `ledger_versions_to_revert_A2_20260723.txt` — **655** versions a reverter (661 − 6 métricas preservadas).
- Integridade provada: `md5` local == `md5(string_agg(... order by version))` em prod = `24a6139f82a776d91c7f68c61019c5b7`.

⚠️ **Falta o backup full-fidelity** (coluna `statements`, 988 kB) — só o `pg_dump` carrega. **Pré-condição** do CTO (passo c abaixo). O `.txt` sozinho NÃO restaura `statements`.

---

## 2. Estado corrigido vs. spec

- Ledger de prod = **661** linhas (spec dizia 655).
- Repo alvo = **7** migrations (spec dizia 1). PR #1233 leva origin/main de 846 → 7.
- As 6 de métricas têm mismatch de versão (arquivo `2026072223xxxx` vs ledger `20260723012916+`).
  **Resolvido no repo** (PR #1233 renomeia arquivo → versão do ledger). Ledger fica intacto nessas 6.

**End-state (7 linhas no ledger):**
```
20260101000000  baseline_prod_schema           (INSERIR via repair applied)
20260723012916  metric_revenue_stream_canonical (JÁ no ledger — manter)
20260723012941  sale_events_producer_identity   (manter)
20260723013018  carteira_emits_sale_events      (manter)
20260723013051  backfill_carteira_orders        (manter)
20260723013121  funnel_stream_by_customer_moment (manter)
20260723013203  reetiqueta_funnel_streams       (manter)
```
Todas as outras **655** linhas → reverter.

---

## 3. ⚠️ Ordem serial obrigatória (não-negociável)

1. **Merge do PR #1233** em main (botão do CTO) → origin/main passa a ter as 7 migrations.
2. **pg_dump full-fidelity** do `supabase_migrations` (reversibilidade). **Antes** de qualquer DELETE.
3. `migration repair --status applied 20260101000000` (registra baseline).
4. `migration repair --status reverted <655 versions>` (remove as antigas; as 6 métricas ficam).
5. `migration list` — provar 7 local + 7 remote, nada pendente.

**Regra:** só avança pro passo 3+ depois de o Crivo APROVAR este runbook corrigido **e** o `pg_dump` (passo 2) existir.

---

## 4. Lista EXATA de comandos `!` do CTO (colar em ordem, no terminal do CTO)

> Rode a partir do checkout principal `/Users/gabrielaureliogipp/Dev/v8-support-realtime`.
> **Senha sem vazar no histórico** (Crivo): use `read`, não `export` com literal.
> ```bash
> read -rs -p 'DB password prod: ' PW; echo
> read -r  -p 'DB host prod: '     HOST
> PROD_DB_URL="postgresql://postgres:${PW}@${HOST}:5432/postgres"
> ```

```bash
# (a) MERGE do PR #1233 — botão do humano.
#     Preferir deixar os checks de CI rodarem (revisão do diff 846→7):
gh pr ready 1233 && gh pr merge 1233 --squash
#     `--admin` só se a branch protection exigir e o CTO decidir pular checks conscientemente
#     (--admin IGNORA os required checks — Crivo).

# (b) atualizar main local + garantir link/login do CLI
cd /Users/gabrielaureliogipp/Dev/v8-support-realtime
git checkout main && git pull origin main
supabase login            # só se o repair reclamar de auth (sem access-token no ambiente)

# (c) BACKUP full-fidelity do ledger — PRÉ-CONDIÇÃO, antes de qualquer mutação
pg_dump "$PROD_DB_URL" --schema=supabase_migrations -f ledger_prod_backup_full_20260723.sql
test -s ledger_prod_backup_full_20260723.sql && echo "backup OK" || echo "ABORTAR: backup vazio"

# (d) registrar o baseline como applied (só marca ledger, não roda o SQL)
supabase migration repair --linked -p "$PW" --status applied 20260101000000

# (e) reverter as 655 antigas (uma chamada; as 6 métricas NÃO estão na lista → preservadas)
supabase migration repair --linked -p "$PW" --status reverted \
  $(cat ledger_versions_to_revert_A2_20260723.txt)

# (f) PROVAR — deve listar as 7 como local+remote, nada pendente
supabase migration list --linked -p "$PW"
```

Notas:
- `migration repair [version]...` aceita múltiplas versões numa chamada (arg = 9825 bytes << ARG_MAX 1 MB).
- `repair` só faz INSERT/DELETE em `supabase_migrations.schema_migrations`. **Nunca toca schema de negócio, RLS, grants ou dado de tenant.**
- `ledger_versions_to_revert_A2_20260723.txt` está no checkout (gitignored, persiste após o pull).

---

## 5. Verificação pós-execução

```bash
# via CLI (esperado: 7 local + 7 remote, nada "pendente")
supabase migration list --linked -p "$PW"
```
```sql
-- ou via MCP/psql (read-only): esperado exatamente 7 linhas
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
```

---

## 6. Rollback

Se qualquer passo falhar após o DELETE:
```bash
psql "$PROD_DB_URL" -c 'TRUNCATE supabase_migrations.schema_migrations;'
psql "$PROD_DB_URL" -f ledger_prod_backup_full_20260723.sql
```
Restaura as 661 linhas com `statements` intactos. (O `.txt` version|name **não** basta — sem `statements`.)

---

## 7. Análise de segurança (para o Crivo re-revisar)

- **Toca só `supabase_migrations.schema_migrations`?** Sim. Nenhum objeto de negócio/RLS/policy/grant/PII/tenant.
- **Nenhum DELETE solto?** Rota CLI, sem SQL na mão. `repair --status reverted` = DELETE por versão, ferramenta oficial.
- **Guarda?** A lista de 655 é derivada do snapshot md5-verificado; as 6 métricas foram **excluídas explicitamente** e confirmadas presentes no ledger. Antes do passo (d), reconferir o md5 do ledger == `24a6139f82a776d91c7f68c61019c5b7` (se mudou, o ledger drift-ou → reabortar e re-snapshotar).
- **Reversível?** Sim, pelo `pg_dump` do passo (c) — obrigatório antes do DELETE.
- **Idempotência:** `repair` é idempotente por versão; re-rodar não duplica.
- **Blast radius:** PR #1233 é migrations-only (sem frontend) → o merge **não** dispara redeploy de frontend. Ledger desacoplado do deploy.

## 8. Limite conhecido

45 cron jobs de prod (`cron.job`) não são objetos de schema; nenhum dump os carrega. Fora de escopo.
