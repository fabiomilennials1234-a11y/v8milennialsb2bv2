# Reconstrução UAZAPI — estado verificável

Atualizado em 2026-09-11. PR draft: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/2099.

## Ambientes e autorização

- Git `codex/uazapi-rebuild`, base `23cbd6796004113c24684dd394a7e2b2db5114c6` da main.
- Supabase QA `uazapi-rebuild`, ref `qtkohfnephshaxgtzksz`, pai produção `jsjsmuncfkbsbzqzqhfq`.
- CTO confirmou custo US$ 0,01344/h e permanência durante reconstrução. Persistent=true. Exceção explícita ao cleanup por rodada; encerrar cobrança ao finalizar reconstrução.
- TorqueCRM QA e TorqueSDR mantêm identidade da organização/instância autorizadas. Credencial de instância somente no backend; token administrativo não foi necessário nem persistido.
- Destinatário controlado fornecido pelo CTO com autorização para texto/mídia/ações. Identificadores pessoais omitidos dos artefatos.
- Nenhuma alteração de código/schema em produção; webhook remoto da TorqueSDR não foi alterado. Envios de teste saíram da instância real, conforme autorizado.

## Retificação da auditoria inicial

Auditoria inicial usou checkout antigo, não a main atual. PIX, markread, sender, disconnect/delete e proxy regional já tinham correções. Foram preservadas. Inventário antigo não representa produção.

## Implementação

- Criação e conexão separadas, campos documentados, validação de identidade/token antes de persistir credenciais.
- Texto/mídia/menu/PIX compartilham normalização: Pending → queued, messageTimestamp em ms → segundos, identidade/timestamp inválidos falham explicitamente. Aceitação não significa entrega.
- Mídia usa text/docName, download base64Data; menus preservam footerText/listButton/selectableCount. Reação usa text; pin usa pin=true; edição/exclusão usam id documentado.
- Localização, contato, bloqueio/listagem e solicitação de recuperação de histórico implementados no provider. Contatos múltiplos/email múltiplo rejeitados explicitamente na UAZAPI, sem truncamento silencioso.
- Histórico pagina hasMore/nextOffset; chats percorrem totalRecords e excluem JIDs de grupo inconsistentes. Falta de progresso falha explicitamente.
- Hibernação preservada como estado do fornecedor; persistência usa disconnected, sem apagar credenciais. Estados desconhecidos ignorados na atualização da conexão.
- Sender traduz sending → running e completed → completed; estado desconhecido não vira falha terminal silenciosa.
- Monitor usa filtros documentados e conta janela completa localmente. Paginação truncada ou inconsistente retorna desconhecido, impedindo rebind por falsa divergência.
- Webhook aceita chat como objeto, mantém JID de grupo e extrai referência da reação em content.key.ID. Reação atualiza mensagem original, sem disparar nova automação; replay idempotente e compare-and-swap evitam duplicação/perda concorrente.
- Consulta canônica do chat carrega reactions/edited/pinned_at/deleted_at; reação real apareceu após reload. Composer e fallback persistem queued como pending, sem antecipar receipt.
- Ações novas passam pela autorização de conversa; credencial admin deixa de ser exigida para operações com token de instância existente.
- Inventário completo das 139 operações em `docs/integrations/uazapi-capabilities.md`. Há 32 referências literais no backend e 23 operações sondadas. Isso NÃO equivale a 139 recursos de produto implementados.

## Banco isolado

Snapshot somente de schema atual de public/private/backup, obtido por login temporário read-only. Nenhuma tabela de clientes copiada. 334 tabelas públicas, 979 políticas e 1.053 funções públicas, mesmos totais da origem. Metadados de 4.218 colunas coincidem em nome/tipo/nullability/default; lacunas físicas de ordinal de colunas removidas foram excluídas da comparação.

Oito funções continham hostname fixo de produção: substituído pelo hostname QA. Zero referências restantes a esse hostname nas funções inspecionadas; zero crons ativos. Seed mínimo: plano, org QA, instância/credencial, segunda org para teste negativo e usuários Auth sintéticos. Credenciais não acessíveis por anon/authenticated; RPC de credencial também nega authenticated.

Replay automático continua sinalizado MIGRATIONS_FAILED pelo problema preexistente de bootstrap. Restauração manual não equivale a replay completo das migrations e não autoriza merge de banco para produção. Seis blocos DEFAULT ACL de donos da plataforma foram omitidos por permissão; grants explícitos dos objetos existentes foram restaurados. Não replicar grants globais permissivos em novos objetos.

## Homologação real

Evidência sem tokens/conteúdo pessoal: `live-verification-2026-09-11.json` e fixtures estruturais em `tests/fixtures/uazapi/`.

- Texto, imagem, documento e menu aceitos; imagem/documento/menu confirmados Delivered. Downloads de imagem/documento decodificados.
- Áudio, voz PTT, vídeo e figurinha aceitos como queued; consulta posterior confirmou Sent, sem erro.
- Localização e contato aceitos. Localização (0,0) retornou 400 apesar do contrato; coordenadas públicas válidas passaram.
- Edição, reação, pin, unpin, markread e exclusão de mensagem própria de teste aceitos. Markread de mensagem própria não prova receipt visual de uma mensagem recebida.
- Sender: criação, listagem, pausa, retomada (running) e exclusão verificados. Nenhuma pasta agendada de teste deixada ativa.
- Recuperação history reconhecida pelo fornecedor e pelo proxy. Modo exact retornou 404 para mensagem escolhida; não afirmar suporte homologado nem conclusão assíncrona da recuperação.
- Deploy QA de whatsapp-api-proxy, whatsapp-webhook, whatsapp-health-monitor e get-member-permissions.
- JWT real: ausência de sessão 401; outra org 403; admin QA 200. Envio pelo proxy 200/queued. Recuperação inválida 400; recuperação cross-org 403; contato múltiplo e coordenadas inválidas 400.
- SSE capturou envelope real de reação do teste; replay no webhook QA: texto e reação repetidos persistiram uma mensagem e uma reação, DLQ vazia. Segredo incorreto 404. Isso não é reconfiguração nem prova de entrega de webhook remoto diretamente em QA.
- App local em http://127.0.0.1:8099/chat-whatsapp aponta somente para QA, login sintético, caixa TorqueSDR, mensagem e reação de teste renderizaram. Verificação de navegação não equivale a homologação integral de todos os fluxos de interface.

## Verificações de código

224 testes direcionados passaram em 15 arquivos. Deno check passou nos três handlers alterados; corrigidas assinaturas de client genérico que produziam never no webhook. Build passou. Lint ratchet e TypeScript frontend ratchet: zero problemas introduzidos. Suite global comparada anteriormente com main limpa: zero falhas novas; detalhes em `test-comparison.json`. Baselines não ampliados.

## Limites para promover o PR

- PIX: contrato testado; sem envio real de cobrança. Lifecycle disconnect/delete não foi exercitado na TorqueSDR ativa.
- Recuperação exact (404) precisa esclarecimento do fornecedor; history é assíncrono, ainda sem controle dedicado na interface ou ingestão específica de eventos history.
- Certificar recebimento remoto/receipts, reconexão e consumidores indiretos do adapter em ambiente dedicado antes do rollout. Os quatro deploys QA não atualizam automaticamente outras Edge Functions que embutem o adapter.
- As demais capacidades do inventário (grupos, etiquetas, perfil, catálogos, chatbot/integrações administrativas etc.) são lacunas de produto separadas, não escondidas atrás de um proxy genérico.
- PR permanece draft; nenhum merge/deploy em produção autorizado por esta etapa.

## Rodada 2 — disparos, nodes e chat (2026-09-11)

- `/sender/advanced`: CRM mantém delays em ms; adapter converte para segundos inteiros, arredondando para cima. Caption passa como `text`; origem como `info`. Agendamento inválido falha antes de enviar.
- Erro transitório de polling preserva estado da campanha; snapshot inválido não grava contadores. Atualização filtrada por organização.
- Quick Blast real: preview 200, outra organização recusada com `instance_org_mismatch`, criação de 1 mensagem e polling completed. Pasta removida; cleanup marca job cancelled mantendo 1 enviado/0 falhas. Não foi disparado lote de 50 destinatários para forçar o limiar de Mass Send.
- Handlers reais de texto/lista enviaram; lead de outra organização recusado. Menus/PIX preservam tracking; lista ganhou rótulo configurável no node e preview. Templates de campanha também filtram organização.
- Persistência do node/gateway preserva recibos e conteúdo do eco, atualizando só atribuição. Pending do provider fica pendente. Eco autoritativo avança status por UPDATE condicional, sem regressão.
- Chat Chromium em QA: envio pelo compositor, imagem recebida/enviada carregadas; seleções reais reprocessadas mostram título e selo “Selecionou (lista)”, em vez de ID técnico. Figurinha não carregou: fallback explícito substitui bolha vazia; causa do download ainda exige validação.
- Primeiro destinatário é o dono da instância: fromMe=true está correto. Segundo número autorizado para validar entrada real separada; evidência complementar registrada após resposta.
- Controles de UI de lista ainda exibem texto principal da mensagem enviada; representação completa das opções e recuperação de histórico com progresso são próximos incrementos, não funcionalidades homologadas nesta rodada.

Evidência: `live-verification-round2-2026-09-11.json`. Payloads brutos, telefones e tokens ficam fora do Git. A medição de timestamp do sender representa enqueue, não intervalo de entrega; não usar para afirmar intervalo exato.

### Fechamento da conversa entre dois números

Segundo destinatário autorizado: SSE real → webhook QA → banco → navegador. Duas seleções `fromMe=false` persistidas como `list_response`, `received`, títulos Validar/Concluir; bolhas recebidas à esquerda, com selo. Texto e lista de saída chegaram a `read`. Resposta enviada pelo compositor ao segundo número chegou a `delivered`. Não houve resposta textual “Resposta QA”; foram seleções reais, suficientes para o fluxo interativo. Relé filtrado de SSE não altera webhook remoto de produção.

Adicionado suporte visual ao tipo canônico `list_response` além de `listResponse`. Corrigido overflow horizontal da lista de conversas observado no navegador (preview longo alargava wrapper table do Radix). Figura indisponível tem fallback; download de figurinha permanece limitação registrada.

523 testes direcionados em 45 arquivos passaram; Deno check em webhook, status e handlers texto/lista passou. Build e ratchets frontend sem novas falhas nas verificações desta rodada. Não houve execução completa do grafo de workflow nem homologação de PIX ou lifecycle destrutivo.

## Rodada adicional — grafo, mídia e exact

Motor de workflow executou grafo trigger → texto → lista → end com banco/provider reais em QA: completed, quatro passos registrados. Isto cobre o grafo no motor; worker cron e publicação pelo editor continuam pendentes.

Causa da figurinha no QA: bucket media ausente. Configuração reproduzida a partir da origem; download/persistência resultou WebP de 616 bytes, HTTP 200, renderização confirmada no navegador. Helper compartilhado também passa a aceitar base64Data e escopa update por organização.

Exact retornou HTTP 200/success no segundo chat para messageid e id composto. O 404 anterior permanece evidência daquele caso, não indisponibilidade geral. Acknowledgement não prova recuperar conteúdo ausente nem concluir history assíncrono.

645 testes passaram em 50 arquivos. Deno check passou no helper de mídia e motor; sem mudança frontend nesta rodada. Resumo consolidado em `.specs/uazapi-rebuild/RESUMO-TESTES.md`, evidências em `live-verification-round4-2026-09-11.json`.

## Rodada 5 — fila, histórico, menus e PIX

Editor legado: fluxo salvo e ativado pela interface; trigger autenticado enfileirou execução. Worker QA, invocado com autenticação cron, concluiu trigger → texto → lista → end: quatro etapas, zero falhas. Fluxo desativado após teste; cron não habilitado. Publicação versionada no editor guiado não exercitada.

Corrigida fronteira fire_trigger: organização derivada de membro ativo e lead conferido no mesmo tenant. Testes unitários positivos/negativos e tentativa real de outra organização (403), própria organização (200).

Importação do histórico disponível da segunda conversa autorizada concluída: 205 mensagens. Interface mostra diálogo, status e contagem; consulta por instância/conversa, Realtime e polling enquanto ativo. Total desconhecido não gera porcentagem estimada. Não equivale a recuperar mensagem ausente via sync assíncrono do WhatsApp; retry ainda reinicia job.

Lista com metadata persistida mostra seções, títulos e descrições no chat; sem IDs de roteamento. Verificado no Chromium com seleção recebida. Card imediato para mensagem de node sem metadata ainda pendente.

Botão PIX real autorizado aceito e depois localizado como Read. Nenhum pagamento executado. Chave, nome e payload privado fora do Git. Reprodução áudio/vídeo continua pendente: tentativa desta rodada não encontrou elementos de mídia montados, portanto não comprova playback.

691 testes em 58 arquivos passaram (10 novos testes em três arquivos); Deno check do helper, build, TypeScript e lint ratchets passaram sem problemas introduzidos. Evidência: `live-verification-round5-2026-09-11.json`. Produção não alterada.

## Rodada 6 — menus imediatos, playback e retomada

Listas do node e gateway persistem metadata mínima de exibição no envio (seções/títulos/descrições/rodapé/botão), sem IDs internos das escolhas. Insert-on-conflict preserva payload e recibos se o eco chegar antes. Front lê a projeção SQL ou o payload do Realtime; opções e resposta QA ESPERA verificadas no Chromium.

Áudio e PTT: readyState 4, duração 7,01 s e currentTime avançando. Vídeo estava com URL criptografada; helper recuperou MP4 para Storage (3.050 bytes, HTTP 200). Player reproduziu vídeo de 2 s. Não equivale a homologar transcrição.

Espera: resposta real recebida via SSE filtrado → webhook QA → ramo replied → completed. Timeout de 1 minuto também concluiu pelo ramo timeout, após prazo real. Nova chamada do worker não repete execução concluída.

Retry: falha 429 injetada antes do transporte revelou reserva de conteúdo suprimindo retry como falso sucesso. Executor agora fornece node/attempt e texto usa chave de replay por execução/nó/tentativa somente em retry; reserva inicial por conteúdo permanece. Worker retomou e persistiu uma única mensagem real. Falha 503 ambígua continua terminal. Menus, PIX e mensagem de campanha também classificam falhas ambíguas como não retentáveis.

Gateway unificado validado com override temporário apenas em QA e restaurado. Corrigido vínculo do log operacional: usa UUID de lead/instância, nunca ID composto do provider em coluna UUID. Catálogo QA ganhou flag desabilitada por padrão.

700 testes em 59 arquivos passaram. Build, Deno check, TypeScript e lint ratchets passaram sem novos problemas. Worker atualizado somente no QA; fluxos desta rodada desativados; cron segue inativo. Evidência: `live-verification-round6-2026-09-11.json`.

Lifecycle aguarda indicação de instância dedicada. Recuperação de mensagem ausente no histórico upstream, transcrição, publicação versionada do editor guiado e pré-requisitos de produção seguem separados desta homologação.

## Rodada 7 — publicação, cron, retomada e desempenho

Publicação pelo editor guiado retornou published/version 1. Versão antiga recusada com 409; usuário de outra organização com 403. Agendamento real pg_cron chamou worker QA e concluiu execução dessa versão; job se removeu após chamada, segredo temporário removido, zero crons ativos. Tentativa inicial de ativação por UPDATE direto foi corretamente recusada; ativação válida usou RPC autenticada.

Retomada de histórico agora atualiza o mesmo job failed → queued com compare-and-set, preservando cursor/contadores. Fixture interrompida no cursor 100 retomada pela interface. Encontrada contradição real da UAZAPI: offset 100 trouxe página cheia e hasMore=false, mas offset 200 continha mais 15 mensagens. Adapter passa a consultar próxima página quando a atual está cheia. Worker terminou com total 215, em vez de truncar em 200. Isso recupera omissão da paginação disponível; não prova recuperação de histórico ausente no próprio provider.

Transcrição via /message/download retornou texto não vazio usando configuração existente da instância; nenhuma chave foi alterada. QA não tem credenciais OpenRouter/Gemini. Persistência/apresentação integrada da transcrição no CRM ainda não homologada.

**Falha confirmada e ainda não corrigida: reentrada.** Workflow publicado com re_enrollment_enabled=false e execução concluída aceitou novo fire_trigger (triggered=1). Execução de teste cancelada e workflow desativado. Não confundir com proteção contra execução simultânea ou retry, que já foi testada. Este comportamento bloqueia homologação da reentrada.

Desempenho: conversa de 214 mensagens produziu duas respostas de 199.006 bytes de JSON decodificado na observação de 23 s; virtualização montou 11 itens. Zero chamadas do navegador ao provider nesse período. Janela máxima de 1.000 mensagens e backstop de 20 s são candidatos prioritários para paginação/reconciliação mais econômica. Não houve benchmark representativo de carga; análise em OPTIMIZACAO-CHAT.md.

711 testes em 60 arquivos passaram; build, Deno check e ratchets TypeScript/lint sem problemas introduzidos. CI remoto só apresenta Supabase Preview skipped; não certificado. Somente history-sync-worker atualizado em QA. Produção preservada.

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
