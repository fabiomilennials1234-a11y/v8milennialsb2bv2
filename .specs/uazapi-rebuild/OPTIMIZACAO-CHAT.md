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

## Rodada 9 — transcrição, PIX e contrato de limites

Transcrição sob demanda implementada no adapter e proxy autenticado. Mensagem consultada com JWT/RLS e escopo org/instância; gate de responsável revalidado antes do provider. Somente áudio/PTT não apagado. Lease de 120s impede chamadas concorrentes por mensagem; falhas ambíguas da transcrição não são repetidas automaticamente; resultado completo é cacheado com transcription_text/provider/created_at, sem sobrescrever content. Corpo remoto solicita transcribe=true, return_link=false e return_base64=false; credenciais não transitam no navegador. A lease não promete exactly-once se o provider concluir e a persistência falhar.

Chromium: ação real retornou HTTP 200, texto apareceu na bolha e persistiu após reload. Segunda solicitação retornou cached=true; outro tenant recebeu 403. Duas solicitações simultâneas de outro áudio resultaram em 200 e 409. Lease liberada ao concluir. Campos foram acrescentados à projeção do chat, compatível com reconciliação por versões. Não há transcrição automática no webhook. Teste real desta rodada é áudio de saída; o componente e handler não filtram direção.

PIX: card lê projeção mínima de sendPayload ou NativeFlowMessage/payment_info. Mostra recebedor e chave; copia somente a chave, sem apresentar status de mensagem como pagamento. Payload nativo real validado no Chromium; clipboard conferido. Node e gateway persistem somente metadata de exibição para render imediato, sem gravar request inteiro. Nenhum pagamento efetuado.

CI anterior falhava no Deno: getMessageLimits admite números nulos, mas ReachLimit exigia números. Contrato corrigido; null permanece desconhecido e can_send_new_messages=false bloqueia envio explicitamente. Deno check de todo _shared/ passou; 997 testes em 73 arquivos passaram.

Histórico upstream: amostra de 12 mensagens antigas controladas, todas encontradas no fornecedor. Não prova recuperação quando ausentes. Docker não instalado neste host; replay local completo não executado. CI do HEAD permanece sem certificação; resultado de Supabase Preview skipped não é sucesso.

Lifecycle: usuário autorizou instância alternativa. Desconexão e geração de QR concluíram antes da mensagem seguinte, que adiou esta etapa. Reconexão não confirmada; nenhuma exclusão realizada. Usuário foi informado imediatamente. Por nova orientação, lifecycle fica por último usando TorqueSDR; nenhuma chamada adicional de conexão foi feita. Nenhum deploy/schema em produção. A alteração operacional da conexão autorizada não deve ser confundida com produção intacta.

Validação final da rodada 9: build e ratchets TypeScript/lint sem novos problemas; Deno de todo _shared aprovado; guarda de versões de migrations sem colisões. Baselines preservados.
