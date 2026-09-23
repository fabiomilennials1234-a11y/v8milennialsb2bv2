# Copilot e workflows: admissão antes de HTTP

Auditoria de código e histórico em 23/09/2026. Definições dos dois triggers de etapa e seus vínculos foram conferidos por leitura do catálogo de produção. Nenhuma escrita em produção nesta análise.

## Resultado implementado nesta fase

Migration `20271021000030_workflow_stage_http_admission.sql` adiciona uma guarda ao trigger ativo `trigger_workflow_pipeline_stage_changed`, vinculado a `pipeline_entries`. Antes de chamar `process-workflow-executions`, verifica se a mesma organização possui algum workflow ativo com tipo `stage_changed`, `deal_won` ou `deal_lost`.

Sem nenhum candidato dessas três classes, o evento não produz HTTP. Com qualquer candidato, o caminho anterior permanece: mesmo corpo, identidade do ator, contexto do negócio, autenticação, momento de despacho e processamento posterior. A guarda não tenta reproduzir os matchers de configuração, nem agrupa mudanças diferentes de etapa. Não altera o trigger de funis customizados ou a função legada sem vínculo ativo.

As três classes são necessárias: `supabase/functions/_shared/workflow-trigger.ts:368` deriva ganho/perda ANTES de procurar workflows de mudança de etapa. Filtrar somente `stage_changed`, ou trocar HTTP por `fire_workflow_trigger` SQL sem paridade dessas derivações, perderia automações válidas.

**Semântica de configuração:** admissão usa o snapshot visível ao evento. Ativar um workflow depois da mudança de etapa não provoca execução retroativa daquele evento. O próximo evento usa a nova configuração. Esta decisão evita depender do atraso variável da entrega HTTP para definir quais eventos pertencem a uma automação recém-ativada.

**Segurança:** guarda por `NEW.organization_id`; apenas leitura de configuração. `CREATE OR REPLACE` preserva grants, `SECURITY DEFINER`, search path e contrato do trigger. Índice existente por organização atende o acesso; não foi adicionado índice sem medição de necessidade. Erros seguem o comportamento anterior de não abortar movimentação do cartão.

**Validação:** `node --test tests/integration/workflow-stage-admission.test.mjs` executa migration real em PGlite, com coletor HTTP isolado. Cobre organização diferente, workflow inativo, tipo irrelevante, cada uma das três classes positivas, payload completo e autoria, stage sem mudança, funil customizado, ativação posterior, grants, search path, rollback e reaplicação. Builder `scripts/build-workflow-admission-preview-validation.mjs` exporta `buildWorkflowAdmissionPreviewValidation()` para o ensaio remoto: usa somente namespace `workflow_admission_test`, substitui autenticação e transporte por fixtures, não toca `public/auth/net`, e desfaz tudo com `ROLLBACK`. O próprio SQL gerado também passou em PGlite com verificação de cleanup. Ainda não equivale a ensaio remoto de produção. Rollback restaura definição original capturada do catálogo, sem a guarda.

## O que o histórico permite afirmar

Fonte: `docs/operations/supabase-capacity-edge-history-2026-09-23.json`, sete dias de `function_edge_logs`, OPTIONS excluído. É histórico HTTP observado, não ledger de faturamento.

| Endpoint | Requisições em sete dias | Projeção linear em 30 dias |
| --- | ---: | ---: |
| `agent-message` | 37.901 | 162.433 |
| `process-workflow-executions` | 23.394 | 100.260 |

Não há entrada de `copilot-batch-processor` nesse levantamento. Isso não comprova que a feature está morta ou que a configuração atual de rollout esteja desligada; apenas impede atribuir economia histórica a esse caminho.

O total de workflows mistura cron, execução, gatilhos e possíveis probes. Não pode ser usado inteiro como economia da migration 30. A redução real é **uma chamada por evento de etapa que antes chamaria HTTP e não possui candidatos na organização no momento do evento**. Ainda não existe contagem histórica desse subconjunto: economia reservada no plano de 1,4M = **zero até medição**.

Comparar antes/depois por modo e organização com contadores agregados, sem conteúdo de mensagens, telefones, JWTs ou segredo cron. Validar também execuções derivadas, latência entre evento e execução e taxa de erro. Redução de consultas internas é outra métrica; não reduz automaticamente invocações Edge.

## Copilot: por que não remover chamadas isoladamente

Caminho atual:

1. `supabase/functions/whatsapp-webhook/handler.ts:668`: allowlist `COPILOT_QUEUE_ENABLED_ORGS` escolhe fila; fora dela segue chamada direta a `agent-message` (`:745`). Uma falha ao inserir na fila cai no caminho direto.
2. `supabase/migrations/20260101000000_baseline_prod_schema.sql:15480`: `notify_copilot_batch_processor` chama HTTP para cada INSERT. Trigger `FOR EACH ROW` em `:32812`.
3. `supabase/functions/copilot-batch-processor/index.ts:81`: cada chamada espera 5 segundos; consulta maturidade e retorna `not_ready` se houve mensagem recente (`:101`). Claim acontece depois (`:109`).
4. `supabase/functions/_shared/copilot-batch-maturity.ts:6`: janela de 5 segundos desde a última mensagem e limite absoluto de 15 segundos desde a primeira.
5. Processor chama `agent-message` por HTTP em `supabase/functions/copilot-batch-processor/index.ts:176`.
6. `supabase/functions/agent-message/index.ts:199`: lock deduplica trabalho depois que a invocação Edge já ocorreu. `lead_replied` e criação de lead podem acontecer mesmo sem agente IA ativo (`:229`, `:313`). Absorção após LLM em `:594` não torna o HTTP inicial gratuito.

Para N mensagens enfileiradas e B lotes efetivamente processados, o caminho sem retries pode consumir N chamadas ao processor + B chamadas ao agente. Agrupar geração de IA não equivale a agrupar invocações Edge.

**Contraexemplo de remover o segundo wake:** mensagem em t=0 inicia worker; mensagem em t=4 não inicia outro. Worker acorda em t=5, encontra somente 1 segundo de silêncio e encerra `not_ready`. Sem wake em t=9, o lote espera resgate do sweep. O sweep trata pendências sem retry com mais de 30 segundos e roda em sua cadência existente (`baseline:18163`); portanto não preserva a experiência de 5 segundos. Não implementar apenas `IF EXISTS pending THEN RETURN` no trigger.

## Próxima mudança mínima de arquitetura Copilot — não implementada

Aplicar somente às organizações que já usam fila, sem ativá-la globalmente para tentar economizar:

- Registrar, em transação, um único acionamento pendente por chave de lote. A chave atual é telefone + organização; alterar para incluir instância muda semântica e exige decisão separada.
- Novas mensagens atualizam o prazo/marcador do lote, sem disparar outro HTTP enquanto um consumidor vivo possui a responsabilidade.
- Consumidor mantém essa responsabilidade ao encontrar lote imaturo: recalcula o próximo vencimento `min(última mensagem + 5s, primeira + 15s)` e aguarda novamente, dentro do orçamento de execução. Não encerra silenciosamente sem sucessor durável.
- Claim e encerramento transferem responsabilidade atomicamente. Mensagem que chega entre última leitura e liberação não pode ficar sem acionamento. Falha HTTP, morte do processo, lease vencido e retry precisam resgate durável.
- Preservar efeitos `lead_replied`, criação de lead, bloqueio humano, contexto de mídia, envio parcial, deduplicação de envio e orçamento do LLM. Não antecipar o filtro “sem agente” ignorando esses efeitos.

Se o novo caminho resultar em W acionamentos de processor para os mesmos N eventos e B gerações, redução demonstrável = N − W, descontadas novas chamadas de resgate. Não presumir W=B em presença de falhas, novos lotes durante processamento ou limites de execução. A chamada processor→agente continua existindo; extraí-la para serviço compartilhado é outra mudança, com avaliação própria de CPU, cancelamento, autenticação e retry.

Critérios para autorizar rollout: cenários t=0/t=4 respondem após janela existente; rajada contínua respeita limite absoluto; concorrência multi-tenant não compartilha lote; entrega parcial não repete mensagens; falha antes/depois de claim não perde mensagem; métricas mostram redução de invocações sem regressão de latência p95/p99 e sem redução de execuções comerciais esperadas.

## Limites da entrega

Migration 30 é redução complementar, sem percentual prometido. Debounce, fila e contrato Copilot não foram alterados. Permanecer dentro de 1,4M não pode depender de economias ainda não medidas destes caminhos; segue necessário o orçamento de ingresso e workers descrito no plano principal.
