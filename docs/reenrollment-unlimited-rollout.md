# Reinscrição sem limites

Com reinscrição ligada, um novo evento elegível pode iniciar outra participação após o término da anterior, sem máximo histórico ou intervalo de dias. Desligada, a primeira participação continua sendo a única permitida por negócio. Isso vale para todas as organizações, inclusive configurações que já estavam ligadas com limites antigos.

Os campos antigos permanecem no schema/payload por compatibilidade; não fazem parte do novo controle. Nenhum backfill altera configurações de clientes. Rascunho segue exigindo publicação para promover configurações. A mudança não publica rascunhos, não liga automações e não recupera eventos anteriores automaticamente.

## Entrega

1. Aplicar somente `20271021000022_unlimited_workflow_reenrollment.sql`, após conferir a definição atual do guard. Não usar db push amplo: o ledger de produção tem drift conhecido.
2. Verificar a função, search_path, SECURITY INVOKER e ausência de EXECUTE para anon/authenticated. Nenhum grant, RLS ou filtro de organização é ampliado.
3. Publicar frontend com a UI simplificada. Fazer backend antes do frontend para que a promessa do botão corresponda ao comportamento do banco.
4. Observar admissões e duplicatas; só recuperar históricos mediante seleção explícita. Dedup de eventos, chain depth e bloqueio de execução ativa permanecem intactos.

A migration foi criada pela CLI e renomeada para seguir a sequência sintética do repositório: um prefixo de data real 2026 seria executado antes dos guards de 2027 e teria seu efeito sobrescrito num replay.

## Verificação e rollback

`node scripts/test-unlimited-reenrollment.mjs` executa o SQL real em PostgreSQL isolado (PGlite), reproduz o bloqueio anterior, verifica 105 reinscrições, os quatro estados ativos, reinscrição desligada, sujeitos diferentes, isolamento de organização, grants e rollback.

`src/modules/workflows/components/ReenrollmentConfig.test.tsx` verifica a UI sem os campos antigos e a alternância do booleano, preservando payloads compatíveis. `supabase/tests/workflow_reenrollment_guard_test.sql` acompanha o novo contrato para QA com fixtures controladas.

Para rollback do banco, restaurar a definição de `20271021000003_workflow_active_enrollment_guard.sql`, cuja equivalência com a definição de produção foi verificada no diagnóstico. Depois reverter o frontend pelo fluxo de PR. As colunas antigas não foram alteradas, portanto seus valores continuam disponíveis. Rollback não desfaz inscrições já realizadas nem mensagens enviadas.

Limite da validação: em 21/09/2026 o inventário do Supabase continha duas previews de outros trabalhos. Nenhuma preview adicional foi criada ou removida. PGlite valida a função SQL e os resultados, mas não substitui um ensaio de concorrência entre conexões no ambiente completo. O advisory lock e o predicado de execução ativa foram preservados sem alteração.
