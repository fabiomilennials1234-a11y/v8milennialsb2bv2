# Pergunta com botões — implementação e evidências

Estado: implementação em andamento, recurso desabilitado. Envio real com e sem imagem comprovado; ramificação pelo novo executor ainda não exercitada em produção.

## Base e isolamento

Worktree `/Users/gabrielaureliogipp/Dev/wt-whatsapp-question-buttons`, branch `codex/whatsapp-question-buttons`, base `origin/main` `0d20ce8b8` de 2026-09-21. A árvore original `codex/Carteira`, baseada em agosto e com alterações de outras tarefas, foi preservada. Os patches foram adaptados à base atual.

A base já normaliza aceite Uazapi, impede retry automático de `/send/menu` e contém versões imutáveis `workflow_guided_versions`. Essas capacidades foram reutilizadas. PRD [#2141](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/2141) e tickets #2142–#2150 publicados; nenhum encerrado apenas com testes de contrato.

## Fronteiras TDD

- Provider → cliente real → HTTP Uazapi, substituindo somente transporte externo nos testes automatizados.
- Gateway → dispatch → provider → cliente real; banco/HTTP simulados são dependências externas, não prova de RLS ou concorrência.
- Editor público: criação/configuração, IDs estáveis, conexões e publicação.
- Executor público → envio governado → persistência de ocorrência; RPCs de reserva, aceite e resposta verificadas no banco em etapa separada.

Ciclos iniciais encontraram perda de `imageButton` no adapter e no gateway. Campo opcional atravessa ambos sem alterar chamadas legadas. Na base antiga também foram corrigidos tracking e rodapé; a base atual já continha esses dois comportamentos. Nenhum retry de menu foi acrescentado. `track_id` serve à correlação/reconciliação, não oferece idempotência no provedor.

## Evidências reais autorizadas

Usuário autorizou testes em produção e envio pela **TorqueSDR** ao número informado na conversa. Não repetir pedido de autorização de ambiente ou destinatário para esse escopo.

### Texto e botões

Uma requisição, três opções. HTTP 200, inicialmente `Pending`; histórico posterior `Read`. Usuário confirmou clique em A. Banco recebeu três eventos distintos B, C, A nessa ordem de persistência. Todos contêm `buttonOrListid`, mesma referência `quoted` e `fromMe=false`.

Comparação em memória com o histórico Uazapi confirmou que `quoted` corresponde a **`messageid` do WhatsApp**, não ao `id` interno. `track_id` dos cliques veio vazio. Payload original: `messageType=ButtonsResponseMessage`, normalizado como `buttons_response`. [Evidência sanitizada](./evidencia-envio-real.json).

### Imagem fixa e botões

Uma requisição com logo fixo e duas opções. HTTP 200, `Pending`; usuário escolheu **Imagem OK** e confirmou nesta conversa. Callback: `messageType=TemplateButtonReplyMessage`, normalizado como **`text`**, com `buttonOrListid` esperado e referência `quoted`. Portanto, classificar o clique apenas por `message_type` perderia essa resposta. [Evidência sanitizada](./evidencia-imagem-real.json).

Cliente Android/iOS/Web/Desktop não informado. Testes executaram provider e cliente locais contra HTTP de produção; não validaram deploy do gateway, executor ou ramificação completa. Ordem de persistência não equivale, por si só, ao relógio de ingresso durável definido na especificação.

## Implementação local

- Contratos de envio transportam imagem opcional e preservam separadamente o ID WhatsApp.
- Editor inclui node, até três opções com IDs estáveis, saídas por opção e saídas alternativas; publicação exige conexões válidas, rascunho pode permanecer incompleto.
- Runtime em construção: snapshot, reserva anterior ao HTTP, pausa durável, envio pelo governor, correlação por organização/instância/conversa/ocorrência/mensagem original/opção e resolução única.
- Migration nova ainda **não aplicada permanentemente**. Teste inicial confirmou ausência do RPC de reserva em produção (red esperado).
- Snapshot protegido, cancelamento com aceite tardio e fonte única da flag corrigidos e verificados no rollback do banco.

## Verificações e limites

Na base atual, última execução integrada registrada: **131 testes passaram em oito arquivos**, cobrindo provider, cliente, gateway, ações WhatsApp, executor, publicação, painel e toolbar. Testes adicionais do editor e do banco ainda em andamento; esse número não representa validação integral do produto.

Histórico operacional, referências/portabilidade e falhas anteriores à reserva implementados e validados (detalhes abaixo). Pendente: ciclo ponta a ponta implantado pelo novo caminho privado e matriz de clientes. Tratamento de envio incerto e fila implementados no backend, com limites de validação descritos abaixo. Timeout/outra resposta, ingresso durável, imagem no editor/storage/snapshot e disputas concorrentes têm evidências abaixo. Sem deploy, ativação da flag ou alegação de prontidão para produção nesta etapa.

## Banco: evidência transacional

Em 2026-09-21, migration candidata e fixtures sintéticas executadas em **uma transação em produção, encerrada com ROLLBACK**. RPCs exercitados sob `service_role`; triggers existentes preservados. Passaram: privilégios de funções/tabelas, snapshot imutável, edição do workflow sem alterar snapshot, isolamento entre organizações, reserva sem reenvio, resposta antes do aceite, A persistido primeiro vence mesmo com B processado primeiro, replay sem segundo passo, prazo de 24h desde aceite, cancelamento com aceite tardio e flag ausente bloqueando nova execução.

Consultas independentes antes/depois confirmaram ausência da tabela, coluna e organizações de teste. [Evidência sanitizada](./evidencia-banco-rollback.json). [Harness reproduzível](../../tests/integration/workflow-buttons/README.md). Nenhuma migration registrada como aplicada permanentemente.

A fatia de ingresso durável adiciona registro antes da normalização/persistência e reconciliador limitado para recuperar a interrupção antes de `whatsapp_messages`. O relógio é obtido após os locks compartilhados com timeout. Essa recuperação foi exercitada no rollback da migration 62; ainda falta ciclo completo com funções implantadas.

## Qualidade da base isolada

Instalado `npm ci --ignore-scripts` no próprio worktree; removido apenas o symlink de dependências compartilhadas. O diretório original permanece intacto. Dependências compartilhadas estavam fora do lock (Supabase 2.111 versus 2.89 e TypeScript 5.9 versus 5.8), causando diagnósticos alheios ao patch.

Com dependências do lock: build (Vite 6.4.3), `lint:ratchet`, `lint:deps:check` e `typecheck:ratchet` passaram sem delta novo. Quatro erros de tipos dos testes novos foram corrigidos com fixture completa de `NodeProps`, sem casts que escondessem campos ausentes. Baselines não ampliados.

Node local 26 também apresentou `localStorage` indisponível em testes existentes. Repetição do teste público `VoiceCallButton` no Node 24, versão principal usada no CI, passou nos 26 casos. Suíte completa verificada nesse runtime: 11 falhas fora do baseline foram reproduzidas exatamente na base limpa `0d20ce8b8`; detalhes em `falhas-herdadas.json`. Baselines não ampliados.


## Validação adicional de 2026-09-21

- **Inbox em produção com rollback:** ordem de ingresso, replay sem alterar relógio, 13 formatos de resposta, resposta antes do aceite, ignorados, timeout e recuperação sem mensagem persistida. Limpeza integral confirmada. `evidencia-inbox-rollback.json`.
- **Imagens em produção com rollback:** bucket privado, orçamento 5 MiB, policy restritiva, bloqueio de acesso direto e retenção dos objetos sintéticos. Limpeza integral confirmada. `evidencia-imagens-rollback.json`.
- **Concorrência real em schema isolado:** três sessões distintas; clique primeiro e texto primeiro venceram respectivamente, ambos processados depois do prazo e com exatamente um avanço. Schema removido e ausência confirmada. Clones vazios não copiam triggers/FKs legados; migrations candidatas preservadas salvo namespace. `evidencia-concorrencia.json`.
- **Imagem fixa local:** upload/preview/substituição/remoção, validação de conteúdo e limites, referência privada sem URL/token no snapshot. 31 testes UI/contrato/API passaram e Deno validou endpoint. Ver `imagem-fixa-tdd.md`.
- **Consulta de reconciliação:** provider/cliente consultam `/message/find` por track/source/conversa e exigem resultado único consistente. Nove testes novos passaram, junto a 99 testes de provider/cliente. Conectada ao worker; recupera aceite original sem reenvio.

Nenhuma migration permanente, deploy ou ativação do recurso nesta etapa. Provider efetivo validado antes do transporte, incluindo override da organização.


## Continuação: envio incerto e fila

Backend implementado e validado com 265 testes, rollback em produção e disputa real de workers no banco. [Detalhes, limites operacionais e pendências](./envio-incerto-e-fila-tdd.md). Nenhum ticket encerrado ou rollout ativado.

## Continuação: histórico, portabilidade e admissão

- Importação remove referências de instância/imagem e exige resolução explícita antes de ativar. Cópia no mesmo editor preserva ativo autorizado e IDs de opções, sem compartilhar objetos mutáveis.
- Trigger de ativação valida saídas, IDs, instância/provider efetivo e objeto privado de imagem no servidor. Rascunhos incompletos continuam permitidos.
- Histórico autorizado mostra fila, envio, espera, incerteza/esgotamento, decisão e rótulo congelado do botão. Revogação de acesso esconde dados em cache. Falhas anteriores à reserva aparecem para administradores sem expor telefone ou mensagem.
- Instância/destinatário indisponível antes da reserva segue `send_failure` atomicamente; replay não duplica avanço e uma reserva anterior nunca é cancelada por esse caminho.
- Exclusão da instância preserva a identidade histórica da ocorrência e ingressos. Prazo continua resolvendo perguntas aceitas; envio incerto continua sem reenvio e pode ser cancelado pelo fluxo existente.
- 223 testes passaram em 17 arquivos nesta rodada. Build, Deno check do worker/endpoint de imagem, lint e typecheck ratchets passaram sem novo erro.
- Migrations 60–68 exercitadas juntas no alvo de produção em transação revertida: ativação, permissões do histórico, falha de admissão e exclusão de instância. Antes/depois confirmam ausência de todos os fixtures e schema candidato. Evidências: `evidencia-release-rollback.json`, `evidencia-admissao-rollback.json`, `evidencia-historico-rollback.json`, `evidencia-ciclo-instancia-rollback.json`.

Estado deste registro: preparação para teste integrado; nenhuma migration permanente ou função candidata publicada. Não equivale à liberação geral nem à conclusão do ticket 09.

## Piloto implantado — 2026-09-21

Após autorização explícita do CTO para testar em produção, migrations 60–68 aplicadas permanentemente e registradas com nomes/versões correspondentes no ledger. Grants das 15 funções candidatas conferidos novamente após COMMIT: nenhuma execução anônima; somente histórico acessível a authenticated, com autorização interna.

Publicadas `whatsapp-webhook` v107, `process-workflow-executions` v163 e `workflow-question-image` v1. Fontes/bundles anteriores arquivados fora do repositório. Todos os 93 arquivos do worker anterior coincidiam com a base revisada; webhook anterior diferia apenas em mudança de retryAt já presente na main.

Piloto único na TorqueSDR, destinatário autorizado terminado em 5289, imagem privada e três saídas para Fim. A flag foi ligada somente dentro da transação de criação/congelamento desse piloto e restaurada antes do COMMIT; permanece ausente/desligada externamente. Não houve habilitação de organização ou rollout do frontend.

Worker aceitou a mensagem em `2026-09-21T20:24:05.971Z`; ocorrência `waiting`, execução `paused`, deadline 24h depois. Aguardando clique para comprovar ramificação e término. Upload deste fixture usou Storage API service_role; autorização do endpoint de upload possui testes separados, não alegar jornada completa pelo editor.

PR draft #2153. GitHub Actions não iniciou jobs por cobrança/limite de gastos da conta; nenhum teste CI chegou a executar. Validações locais descritas acima permanecem a evidência de código. Sem merge e sem conclusão do ticket 09.

Evidências correntes: `evidencia-deploy-controlado.json` e `evidencia-piloto-integrado.json`. Após confirmar resultado, desativar o workflow exclusivo de teste e preservar evidência sanitizada; imagem deve permanecer enquanto houver referência no snapshot.

## Correção: envio ausente no chat — 2026-09-21

CTO comprovou em capturas: mensagem de 17:24 com imagem/botões no WhatsApp Web, ausente no Torque. Consulta confirmou zero `whatsapp_messages` para a ocorrência aceita. Causa: runtime enviava e aceitava a pergunta sem persistir a projeção usada pelo chat; eco do provedor não chegou para cobrir essa ausência.

Migration 69 adiciona projeção transacional no aceite. Texto/rótulos vêm do snapshot, timestamp é o aceite original, `sent_source=workflow`; ID usa contrato composto do webhook, preservando eco existente e status de leitura. Erro de escrita aborta aceite e permite reconciliação sem reenvio. Referência da imagem fica privada, sem URL assinada duradoura em banco.

Contrato SQL red→green verificado em produção com rollback, antes e depois do apply. Migration 69 registrada no ledger; ocorrência piloto reparada disparando projeção do aceite existente, sem nova requisição de envio. Exatamente uma mensagem recuperada, horário 17:24:05.971. Evidências: `evidencia-chat-rollback.json`, `evidencia-chat-reparado.json`.

Segundo gap: componente visual dos botões não renderizava imagem. Frontend corrigido com prévia autenticada renovável; endpoint assina por cinco minutos somente após leitura autorizada da mensagem e correspondência organização/instância/lead da ocorrência. Rejeita referência em mensagem recebida; não exige flag ligada para ler envio já existente. A imagem permanece privada.

Validação: 40 testes em sete arquivos antes do reforço de direção/lead; depois, 16 testes de API/bolha passaram, incluindo caso negativo adicional. Build, Deno check, lint e typecheck ratchets sem erro novo. Mensagem recuperada no banco do chat; conferência visual no navegador não concluída porque ferramenta recusou ações enquanto usuário alterava a janela. Não alegar observação da tela corrigida.

Estado de publicação: migration 69 e endpoint de prévia publicados; texto e botões são compatíveis com frontend atual. **Renderização da imagem no chat ainda depende de publicar frontend do PR #2153.** Não houve merge/deploy do frontend. CI continua bloqueado por cobrança/limite da conta; PR segue draft.

## WhatsApp Menu dentro de Ação — 2026-09-22

Correção de produto solicitada pelo CTO: entrada em **Adicionar Nó → Ação → Tipo de Ação → WhatsApp Menu**, sem item próprio em Controle de Fluxo. Canvas e painel identificam a configuração como Ação/WhatsApp Menu. Seletor compartilhado mantém as permissões de categorias e permite acessar Menu também com `unified_message_node` ligado.

Contrato interno `question_buttons` permanece como representação da execução com espera, sem modificar snapshots, RPCs ou migrations já publicadas. A seleção de WhatsApp Menu cria essa representação; alterar para outra ação remove apenas conexões de saída incompatíveis e mantém conexões de entrada. Menus legados `send_whatsapp_menu` não são convertidos automaticamente ao abrir ou salvar: listas e envios antigos mantêm semântica.

TDD: teste da entrada separada falhou antes da remoção; teste da seleção pela Ação falhou antes da integração. Cobertura do editor exercita seleção com mensagem unificada ligada/desligada, salvamento, troca de ação, conexões, imagem privada e preservação de menu legado. Mudança somente frontend; requer publicação para aparecer em produção. Validação ponta a ponta do piloto original continua pendente.

Verificação desta alteração: 93 testes em oito arquivos passaram (Node 24); build concluído; lint/typecheck ratchets com zero problemas introduzidos. Revisão do diff conferiu gates de organização, compatibilidade dos snapshots e limpeza limitada às saídas quando tipo muda. Nenhuma migration ou edge function alterada.
