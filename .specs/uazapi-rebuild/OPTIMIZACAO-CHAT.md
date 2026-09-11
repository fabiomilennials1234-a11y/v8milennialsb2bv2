# Otimização do chat — estado atual

Paginação e reconciliação leve implementadas e verificadas em QA. Escala de produção ainda depende de ensaio representativo de banco, ingestão e Realtime. Comparações abaixo usam JSON decodificado, não tráfego comprimido.

## Rodada 8 — paginação, reconciliação e reentrada

Chat abre 100 mensagens e carrega anteriores por cursor `(timestamp,id)`, preservando microssegundos. Chromium: conversa real 100+100+14; fixture de volume 1.314 mensagens em 14 páginas, sem truncamento e com 18 itens montados na amostra final. As 1.100 linhas sintéticas foram removidas; não houve envio WhatsApp para esse ensaio. Ligações acompanham o início do intervalo carregado; seu limite independente de 1.000 registros permanece.

Backstop 20s / fallback 10s preservados. Nova RPC SECURITY INVOKER retorna fingerprint das versões visíveis (`xmin`); corpos só são buscados para IDs novos/alterados. Não acrescenta trigger de escrita ao webhook. Atualizações antigas, hard deletes, páginas sobrepostas, mensagens otimistas e patches Realtime durante HTTP têm cobertura. Snapshot usa todo o intervalo carregado; seu custo cresce com páginas abertas, não é uma fila incremental de eventos.

Navegador: abertura 6.985 bytes de manifesto + 97.476 bytes de conteúdo (100 mensagens), antes 199.006 bytes de conteúdo (214 mensagens). Poll sem mudanças: 88 bytes de resposta HTTP decodificada, antes 199.006. JSON reserializado no teste direto mede 83 bytes; não são bytes comprimidos na rede. Nenhuma chamada do navegador ao domínio UAZAPI. RPC autenticada: organização correta vê 100 IDs; usuário externo vê zero. Sondagem pequena: 30 consultas em concorrência 10, zero erros, p50 145ms/p95 189ms. Não representa volume/concorrência de produção nem certifica SLA.

Reentrada corrigida no banco: trigger invoker serializa por organização/workflow/lead e respeita negócio quando informado. Primeira entrada permitida; execução em voo, desativada, cooldown e máximo total bloqueiam nova inscrição. Canceladas/falhas contam; retomadas por UPDATE não criam nova inscrição. Oito INSERTs simultâneos disputando uma vaga aceitaram exatamente um. Fixture SQL com rollback passou. Workflow guiado publicado ativado via RPC para repetir fire_trigger: HTTP 200, triggered=0, nenhuma execução nova; desativado novamente. Contador do fireTrigger agora informa somente linhas inseridas.

Migrations 20271021000001/000002/000003 aplicadas somente no QA; process-workflow-executions e test-workflow-system atualizados no QA. Antes de qualquer rollout, aplicar RPC antes do frontend e revisar impacto dos limites de inscrição nos workflows existentes. Nenhuma alteração em produção.

Pendências restantes: transcrição persistida/apresentada no CRM; lifecycle com instância dedicada; recuperação de mensagem inexistente no cache upstream; replay completo das migrations/CI; benchmark representativo de banco/Realtime e análise de índices com volume de produção. Não adicionar índices sobrepostos sem medir custo de leitura e ingestão.

Validação da rodada 8: 967 testes / 70 arquivos; build, Deno, TypeScript e lint sem novos problemas. Baselines não ampliados.

Guard adicional master-ghost continua falhando: 23 violações e 42 entradas obsoletas. Comparação executada contra arquivo Git do HEAD anterior produziu saída idêntica; nenhum delta desta rodada. Baseline preservado.
