# PRD — Pergunta com botões no WhatsApp

## Problem Statement

Quem configura automações do Torque precisa enviar uma pergunta por WhatsApp e seguir um caminho diferente conforme o botão escolhido pelo contato. Hoje, enviar um menu e depois aguardar uma resposta não identifica com segurança qual opção de qual pergunta foi respondida. Uma resposta pode alcançar esperas de outras execuções do mesmo contato, e texto visível não é uma identidade confiável para decidir o caminho.

O operador precisa configurar esse comportamento em um único node, visualizar cada saída e confiar que cliques repetidos, respostas atrasadas ou edição da automação não disparem caminhos incorretos. Também precisa tratar silêncio, mensagens livres e falhas de envio sem construir comparações frágeis de texto.

## Solution

Criar o node **Pergunta com botões**: texto, imagem opcional fixa por node, até três botões e prazo configurável de resposta, com padrão de 24 horas. Cada botão tem saída própria. O node também oferece **Outra resposta**, **Sem resposta** e **Falha no envio**. Todas as saídas precisam de destino antes de ativar; encerramento intencional conecta ao node **Fim**.

O node envia pela instância Uazapi pertinente à Conversa do Lead, aguarda de forma durável e encaminha exatamente um resultado. A primeira escolha válida fixa a saída; cliques posteriores não reabrem a pergunta. Texto e mídias seguem Outra resposta sem interpretação. Entrega, leitura e reações não encerram espera.

O prazo começa no aceite do envio pelo provedor, sem contar fila nem aguardar leitura. A elegibilidade da resposta considera seu recebimento no Torque: atraso interno de processamento não invalida uma resposta recebida no prazo; atraso do provedor até depois do vencimento não reabre o node.

Uma pergunta por conversa fica ativa; as demais aguardam. A conclusão do node e o encaminhamento de sua saída liberam a próxima pergunta, sem aguardar todo o ramo. Esta entrega não redesenha Copilot ou atendimento. Os nodes conectados conservam seus contratos.

## User Stories

1. Como pessoa que configura automações, quero adicionar uma Pergunta com botões ao fluxo, para escolher próximos passos pela resposta do contato.
2. Como pessoa que configura automações, quero escrever o texto da pergunta, para explicar a escolha solicitada.
3. Como pessoa que configura automações, quero cadastrar até três botões, para oferecer escolhas curtas e claras.
4. Como pessoa que configura automações, quero nomear os botões, para usar linguagem pertinente ao meu negócio.
5. Como pessoa que configura automações, quero ver uma saída por botão no canvas, para conectar cada escolha ao próximo node.
6. Como pessoa que configura automações, quero reordenar opções sem trocar suas identidades, para organizar a mensagem sem redirecionar respostas antigas.
7. Como pessoa que configura automações, quero adicionar uma imagem fixa opcional, para contextualizar a pergunta visualmente.
8. Como pessoa que configura automações, quero fazer upload da imagem no painel, para não precisar hospedar um arquivo e copiar sua URL.
9. Como pessoa que configura automações, quero visualizar a imagem selecionada, para conferir o conteúdo antes de usar o node.
10. Como pessoa que configura automações, quero substituir ou remover a imagem, para atualizar a pergunta ou voltar ao formato somente texto.
11. Como pessoa que configura automações, quero saber quando o arquivo escolhido não pode ser usado, para corrigir o problema antes de ativar.
12. Como pessoa que configura automações, quero configurar o prazo de resposta, para adequá-lo à abordagem comercial.
13. Como pessoa que configura automações, quero prazo inicial de 24 horas, para começar sem preencher uma configuração repetitiva.
14. Como pessoa que configura automações, quero conectar Outra resposta a um node existente, para tratar texto ou mídia enviados em lugar de um clique.
15. Como pessoa que configura automações, quero conectar Sem resposta a um próximo passo, para tratar contatos que não responderam no prazo.
16. Como pessoa que configura automações, quero conectar Falha no envio a um próximo passo, para tratar impedimentos de comunicação de forma explícita.
17. Como pessoa que configura automações, quero salvar rascunho incompleto, para montar o fluxo gradualmente.
18. Como pessoa que configura automações, quero que a ativação identifique saídas sem destino, para não perder respostas por esquecimento de conexão.
19. Como pessoa que configura automações, quero conectar uma saída ao Fim, para expressar encerramento intencional.
20. Como contato, quero que meu primeiro clique válido determine o próximo passo, para receber o conteúdo que solicitei.
21. Como contato, quero que um clique repetido não duplique o atendimento automatizado, para não receber ações repetidas.
22. Como contato, quero poder responder por texto ou áudio, para não depender exclusivamente dos botões.
23. Como contato, quero que foto, documento, figurinha e outras mídias contem como Outra resposta, para não ser tratado como alguém que ficou em silêncio.
24. Como pessoa que opera automações, quero que conteúdo de mensagem não seja interpretado como clique, para manter a decisão determinística.
25. Como pessoa que opera automações, quero que reações e recibos não resolvam a pergunta, para aguardar uma resposta efetiva.
26. Como pessoa que opera automações, quero que cada resposta pertença à pergunta enviada, para não liberar outra execução do contato.
27. Como pessoa que opera automações, quero distinguir conversas do mesmo contato em caixas diferentes, para não misturar decisões entre instâncias.
28. Como pessoa que opera automações, quero que cliques de perguntas antigas não resolvam a pergunta atual, para preservar o contexto de cada escolha.
29. Como pessoa que opera automações, quero que o prazo comece no aceite do envio, para não descontar tempo anterior ao envio.
30. Como pessoa que opera automações, quero que a contagem não dependa de leitura, para não deixar a execução sem limite quando não houver recibo.
31. Como pessoa que opera automações, quero separar aceite e entrega, para não interpretar sucesso da chamada como leitura ou recebimento pelo contato.
32. Como pessoa que opera automações, quero considerar o horário de recebimento no Torque, para decidir vencimento por uma referência consistente.
33. Como pessoa que opera automações, quero preservar a validade de respostas recebidas no prazo quando o worker atrasar, para não escolher Sem resposta indevidamente.
34. Como pessoa que opera automações, quero que resposta recebida após vencimento não reabra o node, para não contradizer ações já tomadas.
35. Como pessoa que opera automações, quero que reinício do processamento preserve pergunta e resultado, para não reenviar ou repetir o caminho.
36. Como pessoa que opera automações, quero verificar envios de resultado incerto antes de repetir, para evitar duas mensagens quando a primeira já foi aceita.
37. Como pessoa que opera automações, quero ver o motivo de falha, para escolher a recuperação adequada.
38. Como pessoa que opera automações, quero evitar conversão automática para menu numerado, para manter o comportamento que configurei.
39. Como pessoa que opera automações, quero somente uma pergunta ativa por conversa, para não apresentar escolhas concorrentes ao contato.
40. Como pessoa que opera automações, quero que a próxima pergunta seja liberada ao terminar o node, para não depender da duração dos nodes seguintes.
41. Como pessoa que opera automações, quero acompanhar espera, conclusão e saída escolhida no histórico existente, para entender o que aconteceu.
42. Como pessoa que edita uma automação, quero preservar a versão usada por execuções já iniciadas, para não alterar botões, imagem ou destinos já vinculados a uma pergunta.
43. Como pessoa que duplica ou importa um fluxo, quero preservar as conexões e validar referências da organização de destino, para não criar uma configuração que parece válida mas responde incorretamente.
44. Como administrador, quero isolamento de configuração, imagem, execução e histórico por organização, para impedir acesso cruzado.
45. Como membro da organização, quero que envio, edição e consulta respeitem minhas permissões, para usar somente recursos autorizados.
46. Como pessoa que já usa automações, quero preservar menus, esperas e nodes legados, para receber a funcionalidade sem alterar fluxos existentes.
47. Como pessoa que configura automações, quero usar o editor pelo teclado e reconhecer erros junto aos campos, para corrigir a configuração sem depender somente de cor ou mouse.
48. Como responsável pela entrega, quero evidência real de botões com e sem imagem nos clientes WhatsApp suportados, para não publicar uma promessa baseada apenas em mocks.

## Implementation Decisions

### Decisões aprovadas e fronteira

- Workflows é responsável pela configuração, validação, espera e escolha da saída. Communication mantém envio, adaptação Uazapi e ingresso de mensagens. Identity e Storage fornecem autorização e isolamento existentes. Não criar outro motor de atendimento.
- A identidade da opção é independente do rótulo. Correlacionar organização, conversa/instância, execução, ocorrência do node e mensagem enviada. Validar origem e direção da resposta. Preservar IDs opacos do provedor, inclusive quando a conversa não estiver representada por telefone tradicional.
- A ocorrência do node precisa persistir configuração/versionamento, estado do envio, identidade da pergunta, aceite, prazo, resposta elegível e resultado. A forma física deve ser aditiva e definida na implementação, sem alterar migrations já aplicadas ou editar tipos gerados manualmente.
- ADR-0050 exige versão inicial preservada. Vincular execução e destinos à versão pertinente antes do envio; não recarregar a definição editada para decidir um clique antigo. Preservar também o ativo de imagem necessário à execução em andamento.
- ADR-0063 define recebimento no Torque como referência temporal. Registrar ingresso durável antes de reconhecer recebimento e garantir decisão única entre escolha, Outra resposta, expiração e falha. Uma resposta já recebida no prazo não pode perder para um worker de timeout mais rápido.
- ADR-0064 substitui a espera pelo ramo inteiro. A fila protege apenas a ocorrência ativa deste node e libera após conclusão e encaminhamento de saída; não serializa todas as ações ou mensagens posteriores.
- O período padrão é 24 horas após aceite. Aceite é distinto de entrega e leitura. Uma confirmação genérica sem evidência do contrato não deve ser inventada quando o resultado for incerto.
- Falha tem saída explícita, sem fallback automático para opções numeradas. O adapter, o cliente HTTP e o mecanismo de retry precisam respeitar a reconciliação de resultado incerto; a ausência de idempotência do provedor impede presumir envio exatamente uma vez.
- `POST /send/menu`, opções com texto e ID, `imageButton` e `buttonOrListid` são contratos documentados a comprovar na versão usada pelo Torque. Não assumir referência à mensagem original sempre presente, nem importar limites de outra API.
- Imagem fixa por node usa upload, prévia, substituição e remoção. Armazenamento deve respeitar organização e permissões; fornecer ao provedor acesso adequado ao envio sem exposição pública permanente ou URL que expire antes de uma pergunta sair da fila.
- Validação de ativação ocorre também no servidor: texto e opções válidos, teto de três, referências válidas e todas as saídas com destino. Não inferir saída pela ordem das conexões.
- Reaproveitar autorização de Workflows e da instância. A origem da organização é autenticada; alterar IDs enviados pelo cliente não amplia acesso. Histórico e mídia devem respeitar autorização atual.
- Compatibilidade é aditiva: menus e waits existentes não se transformam automaticamente em perguntas. Importação, duplicação e clonagem devem preservar identidade lógica das saídas e criar novas identidades de execução quando necessário.
- A funcionalidade fica sob ativação controlada enquanto as fatias estiverem incompletas. Cada fatia inclui sua segurança e testes; a última validação não serve para adiar essas garantias.

### Propostas técnicas para revisão desta divisão

- Preferir uma única fronteira integrada de teste do ciclo da Pergunta com botões, exercitando executor, gateway, ingresso real do webhook e retomada, em vez de testes separados que reproduzem a lógica de cada helper.
- Para a fila, propor ordem de entrada dentro da mesma conversa, com desempate estável e sem prazo de expiração comercial inventado. A espera na fila fica visível e não reduz as 24 horas. Esta proposta está submetida à revisão junto da divisão de tickets; não é uma decisão anterior do grill.
- A conclusão técnica precisa separar falha comprovada de envio incerto. Prazos de reconciliação, política após esgotamento, tamanho de arquivo e limites de rótulos serão definidos por evidência no primeiro experimento e na fatia pertinente, não por números arbitrários neste PRD.
- Reutilizar preferencialmente a infraestrutura de versões já disponível no momento da execução da tarefa. Se não existir, implementar o mínimo aditivo que cumpra o ADR-0050 para o novo contrato; não assumir que o PRD de outra funcionalidade já foi entregue.

## Testing Decisions

- **Fronteira principal proposta:** executar uma automação autorizada com este node, observar envio, receber evento pelo ingresso de produção e retomar execução; verificar mensagem, saída e estado persistido. Reusar as interfaces existentes do executor e webhook. Não criar API pública nova somente para testes.
- **Banco real para garantias reais:** usar branch de teste do Supabase provisionada/autorizada para a execução futura, sem Docker ou Supabase local. Atrasos, duas chegadas concorrentes, timeout, retomada e isolamento não ficam comprovados por mocks de RPC. Nenhum banco foi criado ou testado nesta etapa de documentação.
- **Fronteira externa do provedor:** simular HTTP e tempo nos testes repetíveis, mantendo gateway, adapter e processamento reais. Capturar fixtures sanitizadas de envios controlados reais para comprovar contrato e renderização. Não enviar mensagens a clientes para validar a implementação.
- **Editor:** poucos cenários Playwright determinísticos cobrem criar/configurar, salvar rascunho, impedir ativação incompleta, conectar destinos, upload e inspeção do resultado. Uma ausência de botão esperado deve falhar o teste, não pular a asserção silenciosamente.
- **Prior art:** suites do executor e seus ramos; integração de claim de execuções concorrentes; pipeline do webhook, persistência e reações; contrato do provider Uazapi; upload de imagem de workflow; duplicação e portabilidade. Aproveitar fixtures e bootstrap, sem copiar funções de produção para dentro do teste.
- **Limites do prior art:** os testes atuais do executor mockam ações; parte dos testes de payload reproduz helpers; os smokes de navegador podem passar sem verificar o fluxo completo. São referências, não evidência suficiente da funcionalidade nova.
- **Cenários de domínio:** cada botão, rótulos iguais em perguntas distintas, Outra resposta para todas as mídias, recibos e reações ignorados, clique repetido/antigo, fim do prazo, recebimento anterior com worker atrasado, recebimento posterior, resposta imediata antes de concluir persistência do envio e edição durante espera.
- **Segurança:** organização A/B, instâncias diferentes, permissão revogada, usuário sem acesso à imagem ou execução e identificadores manipulados. Repetir cenários positivos e negativos na interface pública e no servidor.
- **Recuperação:** resposta perdida do HTTP após aceite, interrupção de worker, replay de evento, indisponibilidade de consulta, falha definitiva e concorrência ao liberar a fila. Verificar que não há reenvio cego nem duas decisões.
- **Compatibilidade real:** texto e imagem fixa com um a três botões em Android, iOS, Web e Desktop. Registrar versão, resultado e limitação encontrada; não tratar aceite da API como prova de renderização.
- Bom teste verifica comportamento observável e invariantes, sem snapshots de estrutura interna, contagem arbitrária de chamadas, cópia do algoritmo ou mocks do próprio comportamento que pretende comprovar.

## Out of Scope

- Redesenhar Copilot, transferir propriedade do atendimento, criar objetivos/ferramentas de conclusão da IA ou aguardar o atendimento terminar.
- Controlar todo o ramo após o node, criar um bloqueio global das automações ou construir nova interface de liberação de atendimento.
- Listas, carrosséis, enquetes, botões de URL, chamada, cópia ou PIX como alternativas deste node.
- Mais de três botões na primeira versão; imagem dinâmica por contato ou produto; inferência de intenção por IA; menu numerado automático.
- Lembretes internos ao node, calendários comerciais e retry de pergunta por ausência de resposta. Fluxos podem conectar suas próprias ações existentes.
- Refatoração ampla dos motores de automação, migração automática do legado ou implantação em produção.

## Further Notes

- O CTO confirmou o resumo funcional final. As propostas de fronteira de testes e divisão em tickets ainda serão revisadas antes de publicação, conforme as skills invocadas.
- Precedência: ADR-0050 para versão; ADR-0062 para escopo; ADR-0063 para recebimento; ADR-0064 para fila. ADR-0060 foi substituído; ADR-0061 não é requisito desta entrega.
- As decisões históricas de intervenção humana não autorizam reintroduzir um novo orquestrador. Verificar apenas integração necessária com cancelamentos/controles existentes durante o node. Se houver incompatibilidade real que exija nova decisão de produto, registrar impedimento específico em vez de ampliar esta entrega.
- A documentação oficial permite IDs nas opções, mas ainda precisamos comprovar payloads e compatibilidade na instância efetiva. Essa incerteza vira primeiro ticket verificável, não promessa de suporte.
- O tracker configurado é GitHub. Após revisão, publicar PRD com `prd` e `ready-for-agent`, e fatias com `ready-for-agent` e dependências nativas. Tickets bloqueados só entram na frente de execução quando seus bloqueadores estiverem concluídos.
- Banco de teste e instância/contatos controlados são recursos necessários às validações futuras. Nesta etapa houve apenas leitura e produção de documentos, sem testes de integração, envio de mensagens ou deploy.
