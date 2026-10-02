# Riofix: movimento protegido e métricas da base atual

Registro de rollout já aplicado em produção (02/10/2026). Estes SQLs são artefatos operacionais; não são migrations para replay automático. O histórico remoto contém:
- 20261002152716 riofix_archived_reply_isolated_draft
- 20261002153534 workflow_opt_in_safe_custom_move
- 20261002154205 workflow_safe_custom_move_require_open_target
- 20261002155418 metric_current_lead_client_base

O RPC de movimento requer serviço, tenant/lead/pipeline coerentes, etapa de origem esperada e negócio aberto. Com entryId não há fallback para outro card. Sem entryId exige exatamente uma entrada aberta. O dispatcher usa esse RPC SOMENTE com safeCustomMove booleano true; comportamento anterior preservado para os demais workflows.

As duas medidas novas contam pessoas pela relação comercial materializada (lead/cliente), respeitam exclusões da coorte e os filtros de origem, responsável, tag, produto e funil. São fotografia atual, não coorte de aquisição por período. O dispatcher de métricas foi modificado por patch aditivo que mantém todo o código instalado.

Os testes SQL usam Riofix, service_role e ROLLBACK. Não deixar fixtures nem ativação de teste persistirem. Executados e aprovados em produção sem envio externo. O trigger de arquivado é exclusivo da org/instância Riofix e falha de forma isolada para não impedir a recepção de mensagens.

Estado operacional: novo retorno de arquivado ativo; painel Leads e clientes ativo; entrada Ganho → Pós-vendas preservada; Bot Atendimento e Primeira mensagem desligados aguardando número interno para teste de envio.

Validação: 160 testes em workflow-safe-custom-move, action-handlers-move-stage, shared-action-handler, estagio-vem-do-negocio; 2.499 cenários de grafo; testes SQL anexos. Publicação process-workflow-executions v178 aplicou somente dois arquivos sobre o bundle v177 e a releitura confirmou o conteúdo.

Reversão imediata: pause-new-rule.sql. Os dois fluxos de envio já estão desligados; manter o caminho opt-in desativado antes de eventual rollback do executor. Backups integrais e definições de workflows ficam no relatório local da implantação, sem copiar o bundle de produção para o repositório.
