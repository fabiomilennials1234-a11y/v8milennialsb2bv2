# HANDOFF-1854 — Renumeração de `produtos_do_negocio`

Issue: #1854 · Branch: `fix/1854-renumera-produtos-do-negocio` · Commit: `78dbfa5a`
Plano e raciocínio da escolha de versão: [`PLANO-1854.md`](./PLANO-1854.md)

## Por que este trabalho existiu

`20270901000010` era prefixo de DOIS arquivos em `main`. `supabase db push` registra
uma versão **uma vez**: aplica a primeira, pula a segunda **em silêncio**. Causa-raiz do
drift prod↔repo do incidente #640, e a razão de `Lint & Build` estar vermelho na `main` —
`Migration version guard` reprovava, e como esse job é portão dos demais, todo PR aberto
reprovava por herança.

Produção **não estava quebrada**: os objetos já estavam lá, aplicados fora do ledger
(prática de apply cirúrgico deste projeto). O dano era (1) a fila do repositório parada e
(2) todo ambiente novo (`db reset`, projeto novo, branch do Supabase) nascendo sem os
objetos de `produtos_do_negocio` — com sintoma de erro de runtime, não de falha de
migração.

## O que foi decidido, e por quê

**`20270901000011`.** Livre em `main`, em `rollback/`, em `archive/` e em todos os PRs
abertos (medido, não presumido). Preserva a ordem de hoje: no empate de prefixo o
`db push` ordena por nome de arquivo, e `erp_pedidos_itens` já rodava primeiro. As duas
migrations são disjuntas — `erp_order_items` de um lado, `deal_items` do outro — então a
ordem entre elas é indiferente de qualquer jeito, e continua antes de
`20270901000020_erp_order_items_revoga_anon.sql`.

Descartado jogar para depois de tudo (`20270903000000`): não ganha nada e afasta o
arquivo do bloco cronológico a que pertence.

## A prova — as duas metades da guarda

| Medição | Antes | Depois |
|---|---|---|
| `check-migration-versions.sh` no checkout (metade **a**) | `1 (baseline 0)` → `exit=1` | `0` → `exit=0` |
| metade **b** (branch × `origin/main`) | `0 colliding` | `0 colliding`, 1059 versões inspecionadas de cada lado |
| **merge ref** — worktree em `origin/main` + `git merge` da branch | `1` duplicata → **FAIL** | `0` → **OK** |
| `check-migration-versions.test.sh` (self-test) | — | `guarda de colisão: 7/7` |
| `check-metric-antipatterns.sh` | — | OK |

O merge ref é o que o CI de fato testa (`actions/checkout` em `pull_request` pega
`refs/pull/N/merge`). Foi reproduzido com worktree descartável, não presumido.

Contagem **só do diretório raiz** de migrations. `rollback/` e `archive/` repetem prefixos
de propósito; `sed 's|.*/||'` colapsa os três e devolve ~180 falsos positivos.

## Ratchets — o que é meu e o que é herdado

- `lint:ratchet` **vermelho localmente**, e não é desta branch: 100% das linhas vêm de
  `.agent/**`, que é **gitignored** (`.gitignore:5`) e não existe no clone do CI. Zero
  achados nos arquivos do diff. **Não regenerei `.eslint-baseline.json`** — o
  `node_modules` local não bate com o do CI e a regeneração apaga assinaturas que o CI
  enxerga.
- `typecheck:ratchet` **vermelho, e herdado — provado**: rodei o mesmo ratchet num
  worktree de `origin/main` **pura**, com o mesmo `node_modules`, e deu **os mesmos 80
  erros introduzidos**. Delta desta branch = **0**. O diff TS inteiro é **uma linha de
  comentário**; TS2345 em `useOnboarding.ts` não sai daí.
- `lint:deps:check` OK.

## ⚠️ O QUE FALTA — ESCRITA EM PRODUÇÃO, NÃO EXECUTADA

Prod tem os objetos mas o ledger só tem `20270901000010 = erp_pedidos_itens`. Depois deste
merge, o próximo `db push` vê `20270901000011` como pendente.

**Correção do que a issue previu:** a reaplicação **não falharia alto**. A migration é
inteira idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `ADD CONSTRAINT` dentro de `DO` guardado). Ela passaria — mas
reexecutando DDL sob lock numa tabela viva (`ALTER TABLE deal_items`, `CREATE UNIQUE
INDEX`) sem necessidade nenhuma. O motivo de inserir a linha continua de pé: **o ledger
tem de dizer a verdade**. O risco é menor do que a issue estimou, não maior.

### Passo 1 — pré-cheque READ-ONLY (prova de que os objetos estão lá)

O último statement da própria migration é um `SELECT` de gabarito. Rodar em prod
(`jsjsmuncfkbsbzqzqhfq`), só leitura:

```sql
-- copiar o SELECT final de supabase/migrations/20270901000011_produtos_do_negocio.sql
-- (linhas 656-693). Todas as colunas têm de vir:
--   fk_deal_id, coluna_updated_at, trigger_updated_at, trigger_tenant_coerente,
--   won_filtra_por_org, won_agrega_por_produto, lancar_auth, atualizar_auth,
--   remover_auth  = true
--   lancar_anon, atualizar_anon, remover_anon                = false
--   as_tres_sao_invoker                                      = 3
```

Junto, o estado atual do ledger:

```sql
SELECT version, name
  FROM supabase_migrations.schema_migrations
 WHERE version IN ('20270901000010', '20270901000011');
-- esperado HOJE: uma linha só — 20270901000010 / erp_pedidos_itens
```

### Passo 2 — a escrita (SÓ com GO explícito do CTO)

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20270901000011', 'produtos_do_negocio', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

Idempotente por construção. Mesmo idioma de `tests/sql/RUNBOOK_phase2_deploy.md:35`.

**Só executar se o passo 1 vier todo verde.** Se qualquer coluna vier `false`, a linha do
ledger seria uma mentira: aí o certo é **aplicar a migration** (ela é idempotente) e só
então registrar.

### Passo 3 — provar

```sql
SELECT version, name FROM supabase_migrations.schema_migrations
 WHERE version LIKE '202709010000%' ORDER BY version;
-- esperado: 20270901000000, 20270901000010, 20270901000011, 20270901000020
```

E `supabase db push --dry-run` contra prod não deve listar `20270901000011` como pendente.

**Eu não executei nada disso, e não estou autorizado a executar.** Escrita em prod é botão
do humano.

## O que a issue pede e ainda NÃO está provado

> - [ ] Um `db reset` em ambiente limpo aplica as duas migrations — provado, não presumido

Não foi feito, e é honesto dizer por quê: exige branch efêmera do Supabase (custo
`$0.01344/h`, e o runbook manda derrubar na mesma sessão) e `psql` **não está no PATH**
desta máquina. O que ESTÁ provado é o mecanismo que fazia a segunda ser pulada: com dois
prefixos distintos, `db push` registra duas versões e aplica as duas. A prova empírica do
`db reset` fica como pendência do Despachante decidir se paga.

## Surpresas

1. **A premissa do brief de que "o seu checkout já dá 0 duplicatas HOJE" é falsa.** A
   branch foi cortada de `main` sem commits próprios, então herdava a duplicata: a guarda
   reprovava no checkout **também**. Não mudou o trabalho — só significa que o vermelho
   era visível sem o merge ref. O merge ref foi reproduzido mesmo assim, porque é a
   metade que o CI mede.
2. **PR #1837 (`fix/agenda-source5-renumera`, OPEN, não-draft) renumera o par da agenda
   para `20270901000000` e `20270901000010` — os DOIS já ocupados na `main`** por
   `erp_ultima_compra_e_marcas` e `erp_pedidos_itens`. Se entrar como está, cria duas
   colisões novas no mesmo bloco que este ticket acabou de limpar. E a `main` já carrega
   `agenda_meeting_events_source` em `20270831000020` e `comando_revoga_anon` em
   `20270831000030` — ou seja, aquele PR parece **superado**. Não toquei. Fica para o
   Despachante levar ao dono da #1837.
3. A migration traz o próprio bloco de asserção + `SELECT` de gabarito no último
   statement. É o que torna o pré-cheque do passo 1 barato e read-only.

## Escopo que NÃO foi tocado, de propósito

Produção · `.eslint-baseline.json` · qualquer coisa de `blast/` (#1724 roda em paralelo) ·
`20270901000020_erp_order_items_revoga_anon.sql:7`, que cita `20270901000010` querendo
dizer `erp_pedidos_itens` — ali está **correto**.
