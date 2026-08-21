# `archive/` — histórico de migrations anterior ao baseline

**Não reaplique nada daqui. Nada. Em nenhum ambiente.**

## O que é isto

As 839 migrations que compunham o histórico do projeto até 2026-07-22. Elas
foram substituídas por um único ponto de partida:

    supabase/migrations/20260101000000_baseline_prod_schema.sql

que é o schema **real** de produção (`jsjsmuncfkbsbzqzqhfq`) capturado com
`supabase db dump --schema public`.

## Por que foram arquivadas

O histórico **não replayava do zero**. O replay morria em jan/2026 — quase no
começo, já que a migration mais antiga era `20260106163757`. Consequências reais,
não hipotéticas:

- O projeto **dev** ficou 404 migrations atrás de prod e foi aposentado em
  2026-07-22.
- A única branch Supabase (`main`, criada 2026-03-11) ficou presa em
  `MIGRATIONS_FAILED` por mais de quatro meses.
- A refundação de métricas precisou ser aplicada por MCP direto em produção.
- O fix de segurança **#1209** (membro desativado lia receita, ranking e
  comissão) foi aplicado em produção **porque não existia ambiente onde testar**.

Além disso o histórico carrega defeitos que o tornam não-confiável como fonte de
verdade:

- **Colisões de prefixo**: 20+ timestamps duplicados. O CLI pula o duplicado em
  silêncio, e o ledger dá falso verde.
- **Drift de datas**: o repo usa prefixos fictícios de **2027**; produção grava o
  relógio real. O #1209 virou `20260722205847` em prod e `20270726000000` no
  repo — a mesma mudança sob dois identificadores, e a versão real ordena
  *abaixo* das 2027 já existentes.
- **Drift de contagem**: 839 arquivos no repo contra 655 linhas em
  `supabase_migrations.schema_migrations` de prod.

## Então por que não deletar?

Porque continuam sendo o **registro histórico** de por que o schema é como é.
Servem para arqueologia — descobrir quando e por que uma coluna, policy ou RPC
nasceu — e para `git log`/`git blame` continuarem contando a história.

O `git mv` mantém tudo reversível: `git revert` do commit que criou este
diretório devolve o estado anterior por completo.

## Se você precisa mudar o schema

Escreva uma migration **nova** em `supabase/migrations/`, com timestamp posterior
ao baseline. Nunca edite o baseline à mão — se ele precisar mudar, regenere-o de
produção.

## Se você está procurando "por que isso existe assim"

```bash
grep -rl "nome_da_tabela_ou_funcao" supabase/migrations/archive/ | sort
git log --oneline -- supabase/migrations/archive/<arquivo>.sql
```
