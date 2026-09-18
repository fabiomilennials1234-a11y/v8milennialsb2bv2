# Correção de execução: etapa de follow-up e adiamento de template

## Diagnóstico e escopo

Em 18/09/2026, a Chique Distribuidora apresentou movimentos para Follow up
recusados por exigência de valor de venda e templates encerrados após quatro
tentativas sob `governor_defer:per_number_cap`.

1. A guarda consultava `stage_key` dentro da organização, mas sem o funil.
   Uma etapa won de outro funil com a mesma chave contaminava o resultado.
2. O transporte descartava `retryAt` do governor. A ação convertia o adiamento
   em erro e o executor esgotava três retries em minutos.

## Comportamento corrigido

- A guarda resolve organização, funil e etapa canônica; roda depois do espelho
  stage_id/stage_key, inclusive em escrita somente por UUID e troca de funil.
- Venda ganha exigente continua recusando valor ausente ou inválido, aceitando
  zero explícito. Edições na mesma etapa continuam livres de nova validação.
- O transporte de template preserva retryAt, incluindo o template de escape.
  O executor pausa no mesmo nó, sem marcar envio, seguir saída de erro ou
  consumir retry/loop. Falha na persistência não é anunciada como pausa salva.
- Não altera workflows, limites de envio, cadastros ou execuções históricas.

## Validação e revisão

- SQL executado em PGlite com a função real de espelho extraída da migration;
  reproduz baseline, prova isolamento, movimentos por chave/UUID/funil,
  exigência de valor e rollback.
- Vitest cobre transporte, ação de template, executor, retomada, budgets,
  saída de erro, timestamp inválido e falha de persistência.
- Review separada de requisitos e padrões/segurança: nenhum bloqueio encontrado;
  sugestões sobre mirror real e falha de persistência incorporadas.
- Nenhuma alteração de ACL: CREATE OR REPLACE preserva a função existente.

## Implantação

Autorização de produção dada pelo CTO na sessão. Aplicar somente
`20271021000020_scope_sale_guard_to_pipeline.sql` e publicar
`process-workflow-executions`, após merge/revisão. Não executar db push geral.

Desvio de QA: previews de outros trabalhos já estão ativos com MIGRATIONS_FAILED;
nenhuma preview concorrente foi criada. Seguido o procedimento alternativo do
runbook de produção: SQL isolado, baseline e rollback exato capturados,
rollback executado em teste e verificação imediata após apply.

Rollback SQL em `tests/fixtures/workflow-sale-stage-rollback.sql` (capturado da
função de produção); para worker, redeploy do commit anterior. Não reaplicar
execuções falhas em lote: envio anterior pode já ter sido aceito.
