# Métricas depois de marcar Ganho

O botão Ganhou chama `definir_desfecho_da_entrada`. A transição de
`deals.outcome` gera `sale_events`; `fn_metric_measure` lê esse histórico,
líquido de estornos. A etapa do kanban continua independente do desfecho.

Em 2026-09-15, o teste transacional com um membro da Sampaio e Moraes
registrou uma venda e a RPC do painel retornou 1. O teste foi revertido.
O cache `metric-measure` não era invalidado pelo botão e o Estúdio não tinha
assinatura dos eventos. Além disso, `sale_events` não estava na publication
`supabase_realtime`.

A ação agora invalida os indicadores da organização imediatamente após
sucesso. O Estúdio mantém uma assinatura por página, filtrada por organização,
para vendas, estornos e ajustes. Eventos próximos são agrupados em 250 ms.
Todas as abas em cache ficam desatualizadas; somente consultas montadas são
buscadas novamente. Reconexão e retorno à aba atualizam os números; durante
falhas de conexão há consulta de recuperação a cada 30 segundos.

## Validação

- Testes React com o hook de métricas real e dois QueryClients independentes;
  ganho, estorno, isolamento entre organizações, reconexão e limpeza de timers.
- Teste do clique Ganhou no DealCardPanel; falha de gravação preserva o cache.
- `node --test tests/integration/sales-metrics-realtime.test.mjs` valida a
  publicação, reaplicação e rollback em PGlite.
- Em produção, teste da RPC de ganho e leitura da métrica em uma transação
  encerrada com ROLLBACK. Membro sem acesso master leu somente sua organização.

A migration apenas publica a tabela existente. Mantém SELECT e RLS atuais,
sem mudar permissões, etapas, valores ou eventos. O rollback está em
`supabase/migrations/rollback/20260915193913_sales_metrics_realtime.sql`.

Antes desta correção, por solicitação do usuário, foi desfeito o vínculo
automático de Vendido na Sampaio e Moraes e estornados os sete lançamentos
gerados por esse vínculo. Os cards permaneceram na mesma posição.
