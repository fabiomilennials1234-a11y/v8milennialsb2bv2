# Riofix: movimento protegido e métricas da base atual

Registro de rollout já aplicado em produção (02/10/2026). Estes SQLs são artefatos operacionais; não são migrations para replay automático. O histórico remoto contém:
- 20261002152716 riofix_archived_reply_isolated_draft
- 20261002153534 workflow_opt_in_safe_custom_move
- 20261002154205 workflow_safe_custom_move_require_open_target
- 20261002155418 metric_current_lead_client_base
- 20261002163705 workflow_safe_move_yields_to_manual_sale
- 20261002164057 workflow_safe_move_locks_destination_stage

O RPC de movimento requer serviço, tenant/lead/pipeline coerentes, etapa de origem esperada e negócio aberto. Com entryId não há fallback para outro card. Sem entryId exige exatamente uma entrada aberta. O dispatcher usa esse RPC SOMENTE com safeCustomMove booleano true; comportamento anterior preservado para os demais workflows.

A revisão acrescentou NOWAIT ao lock do negócio: se a venda manual já o possui, a automação recua com 55P03 e libera o card, em vez de formar um ciclo de espera. O executor reagenda com tentativas limitadas. A etapa de destino recebe FOR SHARE NOWAIT, para impedir que se torne final ou inativa durante a movimentação. O snapshot riofix-archived-reply.sql contém a definição final protegida, mas mantém a criação desligada para recuperação controlada; não reaplicar o INSERT sobre o workflow existente.

As duas medidas novas contam pessoas pela relação comercial materializada (lead/cliente), respeitam exclusões da coorte e os filtros de origem, responsável, tag, produto e funil. São fotografia atual, não coorte de aquisição por período. O dispatcher de métricas foi modificado por patch aditivo que mantém todo o código instalado.

A interface agora reconhece as duas medidas ao editar/salvar fórmulas. Fotografias atuais e fórmulas que as utilizam não consultam nem exibem comparação com o período anterior, que devolveria um falso 0%. Métricas de período, como receita, preservam sua comparação. Essa correção de interface está na PR e ainda depende da publicação do frontend.

Os testes SQL usam Riofix, service_role e ROLLBACK. Não deixar fixtures nem ativação de teste persistirem. Executados e aprovados em produção sem envio externo. O trigger de arquivado é exclusivo da org/instância Riofix e falha de forma isolada para não impedir a recepção de mensagens.

Estado operacional: novo retorno de arquivado ativo; painel Leads e clientes ativo; entrada Ganho → Pós-vendas preservada; Bot Atendimento e Primeira mensagem desligados aguardando número interno para teste de envio.

Validação de banco repetida após as correções: test-reopen.sql cobre 14 cenários, incluindo trigger → fila → configuração salva → RPC → Falando, avanço manual/ganho enquanto a execução aguarda e resposta repetida. test-safe-move.sql e test-metrics.sql também passaram, com ROLLBACK. O teste Vitest riofix-archived-executor usa o grafo versionado e executor/condições/handlers reais, incluindo 55P03 → reagendamento → retomada após ganho; apenas transporte de banco/provedor é simulado. Há testes de edição/salvamento no componente real e preservação da comparação de receita. Os 2.499 cenários de grafo anteriores cobrem Bot Atendimento e Primeira mensagem, não substituem o teste integrado do arquivado.

Publicação process-workflow-executions v178 aplicou somente dois arquivos sobre o bundle v177 e a releitura confirmou o conteúdo. As correções posteriores de concorrência são SQL; não exigiram nova publicação do executor.

Limite de validação: test-safe-move-concurrency.mjs cria tabelas sintéticas e copia o RPC e o trigger de ganho para testar duas sessões. As tentativas via MCP NÃO comprovaram sobreposição: a transação terminou antes da observação da barreira. Não registrar esse teste como aprovado. Ambos os schemas temporários foram removidos e a ausência foi conferida. O harness fica disponível para execução com transporte que permita sessões simultâneas; ele não usa cards de clientes. Também não houve teste de envio WhatsApp real, pois os dois fluxos seguem desligados aguardando o número interno.

Reversão imediata: pause-new-rule.sql impede novos disparos. Uma execução que já passou pela checagem de ativação pode terminar; antes de eventual rollback do executor, conferir ausência de execuções em processamento e manter todos os fluxos opt-in desligados. Os dois fluxos de envio já estão desligados. Backups integrais e definições de workflows ficam no relatório local da implantação, sem copiar o bundle de produção para o repositório.
