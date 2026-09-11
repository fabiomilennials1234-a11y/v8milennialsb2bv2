---
type: changelog
title: Reconstrução UAZAPI — início isolado
status: draft
created: 2026-09-11
updated: 2026-09-11
tags: [whatsapp, uazapi, contract-tests]
related: ["[[whatsapp-stability-plan]]"]
owner: gabriel
---

# Reconstrução UAZAPI — início isolado

## Mudanças

Cliente/provider alinhados a campos documentados de criação, mídia, menus, reações, histórico e quotas. Circuito isolado por servidor e credencial; criação não repetida após resposta perdida. Nenhum deploy em produção.

## Referências

- `supabase/functions/_shared/uazapi-client.ts`
- `supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts`
- `tests/unit/uazapi-openapi-contract.test.ts`
- `.specs/uazapi-rebuild/STATE.md`

## Pendências

Provisionamento Supabase, contrato do servidor efetivo e homologação com destinatário controlado. Auditoria inicial usou checkout antigo; não representa main atual.

## Validação real de leitura

TorqueSDR: identidade remota confirmada, seis endpoints HTTP 200. Payloads estruturais anonimizados registrados. Paginação de chats e mensagens corrigida com base em respostas reais. Fornecedor devolveu quatro JIDs de grupo com flag individual; filtro final usa classificação normalizada. Custo da branch Supabase (US$ 0,01344/hora) segue aguardando confirmação exigida pelo conector. Não houve escrita em produção nem envio.

## Branch Supabase aprovada e provisionada

CTO confirmou custo e permanência durante reconstrução. Branch uazapi-rebuild, qtkohfnephshaxgtzksz, persistent=true, baseada no projeto de produção. Replay automático falhou no marcador do baseline; baseline do repo restaurado com 256 tabelas. Não representa ainda schema completo de produção atual. Seed restrito a org QA/TorqueSDR/credencial; zero crons ativos e mensagens importadas. RPC pela REST API negou anon (401), permitiu serviço (200); adapter com credencial da branch validou identidade e 451 chats individuais. Sem mudança remota de webhook ou envio. Evidência em .specs/uazapi-rebuild/branch-verification.json.

## Continuação — contratos reais e backend QA

CTO forneceu destinatário controlado e autorizou envios. Texto, imagem, documento, menu, áudio, voz, vídeo, figurinha, contato e localização exercitados. Edição/reação/pin/unpin/leitura/exclusão de mensagem própria e ciclo sender também passaram. Pastas sender de teste removidas. Pending/messageTimestamp e sending observados exigiram normalização nova; hibernação, janela de monitor e recuperação history corrigidos. Exact retornou 404; localização zero retornou 400: divergências registradas, não mascaradas.

Schema atual restaurado somente em QA: 334 tabelas, 979 políticas, 1.053 funções públicas e 4.218 colunas comparadas. Oito funções com URL fixa de produção redirecionadas para QA; zero crons. Snapshot não copiou dados comerciais. Status automático MIGRATIONS_FAILED permanece distinguido da restauração manual; DEFAULT ACL da plataforma não reaplicada. Branch retida com aprovação anterior.

Quatro Edge Functions publicadas em QA. JWT real validou 401/403/200 e envio queued. Envelope SSE real, com chat objeto e reação em messages, reproduzido no webhook: uma mensagem/uma reação mesmo com duplicatas, DLQ vazia. Reações usam compare-and-swap e não disparam nova conversa. App QA autenticado carregou a caixa TorqueSDR.

179 testes direcionados, Deno check de três handlers, build, lint e tipos verificados. Inventário das 139 operações registra 32 referências estáticas e 23 sondas, sem afirmar cobertura integral de produto. Estado e limitações atualizados em `.specs/uazapi-rebuild/STATE.md`; evidências em `live-verification-2026-09-11.json`. PR #2099 continua draft, sem produção.

Teste visual adicional encontrou SELECT sem metadados de ações. Query passou a carregar reactions/edited/pinned_at/deleted_at; reação real agora renderiza após reload. Composer mantém queued como pending, incluindo fallback persistido e bolha otimista. Mais 43 testes passaram, total 224 em 15 arquivos; build e lint repetidos após correção frontend.

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

## Paginação e reentrada — rodada 8

QA validou páginas de 100 e histórico com 1.314 registros; 18 itens montados. Reconciliação por versões visíveis/RLS reduziu poll sem mudanças de 199.006 para 88 bytes de JSON decodificado na conversa medida. Reentrada desativada/cooldown/máximo agora aplicados no banco; 8 tentativas concorrentes aceitaram uma vaga. fire_trigger devolveu 0 com reinscrição desativada. Produção intacta; rollout exige RPC antes do front e análise dos limites existentes. Evidência e limitações em `.specs/uazapi-rebuild/live-verification-round8-2026-09-11.json` e `OPTIMIZACAO-CHAT.md`.

## Transcrição e PIX — rodada 9

Transcrição sob demanda com JWT/RLS, gate de responsável, lease e cache persistido com proveniência. Chromium confirmou texto após reload; concorrência 200/409 e tenant externo 403. PIX nativo passou a exibir recebedor/chave e copiar chave, sem inferir pagamento. Corrigido contrato nullable dos limites de alcance; Deno de todo _shared passou. Evidência: `.specs/uazapi-rebuild/live-verification-round9-2026-09-11.json`. Lifecycle adiado por nova orientação: instância alternativa já havia sido desconectada; reconexão não confirmada, nenhuma exclusão, TorqueSDR sem chamadas de lifecycle nesta rodada.
