---
type: changelog
title: "Funil: get_pipeline_page com plano genérico"
status: active
created: 2026-10-05
updated: 2026-10-05
tags: [changelog, performance, postgres, funil, migration]
related: [incidente-2026-10-05-oom-e-restart-desnecessario]
owner: claude-agent
---

# 2026-10-05 — Funil: `get_pipeline_page` com plano genérico

## Mudanças
- **Migration `20271107110000_funil_pagina_plano_generico`**: `ALTER FUNCTION … SET plan_cache_mode = force_generic_plan` em `public.get_pipeline_page` e `public.get_pipeline_stage_counts_by_id`. Corpo, assinatura, SECURITY INVOKER, `search_path` e ACL inalterados (md5 do corpo igual a prod). Nenhum grant novo. Guarda `DO` confere o `proconfig` ao final.
- **Reversão**: `supabase/migrations/rollback/20271107110000_funil_pagina_plano_generico.sql` (`RESET plan_cache_mode`).
- **Status**: escrita, NÃO aplicada. Aplicar fora do pico, depois de reconferir o topo do ledger.

## Por quê
- `get_pipeline_page` é o 2º maior consumidor do PostgREST no pico: 4.636 chamadas/h, 3.334 s/h; distribuição bimodal (mín 1,3 / máx 1.821 / média 103 ms).
- No modo `auto` do PL/pgSQL, as 5 primeiras execuções de cada conexão saem com plano **específico**: varre a etapa inteira avaliando a RLS de `leads` linha a linha (membro: 676 ms, 29.145 buffers). Da 6ª em diante o plano **genérico** para em 20 linhas (6 ms, 1.749 buffers). O pool do PostgREST recicla conexões, então o caminho lento se repete o dia todo.
- O diagnóstico inicial apostava no contrário (genérico ruim); a medição como `authenticated` com claims reais refutou — contestação registrada no cabeçalho da migration.

## Números (prod, só leitura, BEGIN sem COMMIT)
| Caso | específico (ms) | genérico (ms) |
|---|---|---|
| membro, sem filtro | 728 | 6,2 |
| cursor, página 10 | 660 | 6,1 |
| filtro de responsável | 656 | 9,4 |
| busca "silva" | 693 | 16 |
| busca sem resultado | 672 | 164 |
| responsável inexistente | 826–1.010 | 154–211 |
| tag inexistente | 763–1.496 | 170–221 |
| admin | 17 | 3,6 |
| contagens, membro | 797 | 181 |
| contagens, admin | 14 | 16 |

QA: ids, ordem e contagens idênticos nos 3 modos (custom/auto/generic) para membro e admin.

## Proteção contra regressão
- `tests/unit/pipeline-page-plan-cache-contract.test.ts`: reconstrói, na ordem das migrations, o último SET de cada função; um `CREATE OR REPLACE` futuro sem o SET apaga o `proconfig` e reprova o contrato. Aceita schema opcional e nomes entre aspas.
- `tests/integration/pipeline-page-plan-cache-mode.test.mjs` (PGlite, no CI em `.github/workflows/test.yml`): mecanismo, grants, corpo, guarda e rollback.

## Como aplicar
1. Reconferir `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3` (topo em 2026-10-05: `20271106000010`).
2. Aplicar fora do pico (`lock_timeout` 5 s; cada conexão recompila uma vez).
3. `select proname, proconfig from pg_proc where proname in ('get_pipeline_page','get_pipeline_stage_counts_by_id')` → deve listar `plan_cache_mode=force_generic_plan`.
4. Após algumas horas, `pg_stat_statements`: média 103 ms e máx 1.821 ms devem cair.

## Fora de escopo
- Front do funil (~70 chamadas por move) e RLS de `leads` avaliada por linha — trilhas próprias.
- Herdado: paginação `created_at < p_cursor` sem desempate (ver [[paginacao-de-conjunto-perde-linha-em-empate]]).
