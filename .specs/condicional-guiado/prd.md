## Problem Statement

Quem configura automações do Torque CRM precisa traduzir uma intenção comercial para campos, operadores e valores técnicos. Isso exige conhecer nomes internos, escrever valores que já existem no CRM e interpretar um resumo pouco legível. Regras combinadas, negócios múltiplos e conversas em várias caixas tornam o comportamento difícil de prever.

A main auditada já oferece seletores de origem, UTM, responsáveis, campos personalizados e etapas por identidade. Portanto, o problema não é ausência total de seletores: falta uma experiência guiada consistente, com comparações adequadas ao tipo, grupos claros e uma avaliação confiável que corresponda ao que a pessoa configurou.

Uma melhoria apenas visual seria insuficiente. Ausência de dados, referências excluídas, falhas de consulta e histórico incompleto podem produzir decisões comerciais erradas. Alterações em fluxos ativos, permissões e consultas a registros diferentes também precisam ter significado explícito.

## Solution

Entregar um condicional guiado, no qual a pessoa escolhe informação, comparação e valor a partir dos dados reais da organização. Manter texto livre quando o conteúdo precisar ser informado, mostrar apenas operadores pertinentes e permitir combinar regras com Todas/E e Qualquer/OU em até três níveis de grupos.

O contexto identifica qual negócio e qual conversa serão avaliados. O canvas mostra um resumo fiel, e o teste explica o resultado de cada condição avaliada ou o impedimento encontrado. O condicional decide Sim ou Não quando a avaliação é concluída; não aguarda que a condição se torne verdadeira.

Esta especificação cobre a **primeira entrega**, com tempo corrido, publicação versionada, autorização e compatibilidade. **Tempo comercial e calendários compartilhados ficam na segunda entrega**, já aprovada conceitualmente. A divisão não remove garantias de segurança da primeira entrega nem adia outros requisitos silenciosamente.

Exemplo de configuração: lead possui tag Distribuidor E existe negócio em aberto no funil Comercial, etapa Proposta, com valor acima de R$ 5 mil E a mensagem selecionada contém qualquer uma das expressões preço, orçamento ou cotação.

## User Stories

1. Como pessoa que configura automações, quero escolher informações em um catálogo pesquisável, para encontrar a condição sem conhecer nomes internos.
2. Como pessoa que configura automações, quero informações organizadas em Lead, Negócio, Conversas, Atividades, histórico comercial e Data e horário, para descobrir possibilidades com contexto.
3. Como pessoa que configura automações, quero encontrar termos usuais, como vendedor para responsável de vendas, para usar meu vocabulário comercial.
4. Como pessoa que configura automações, quero selecionar tags cadastradas, para evitar erros de digitação e referências ambíguas.
5. Como pessoa que configura automações, quero selecionar responsáveis da organização, para comparar pessoas por identidade.
6. Como pessoa que configura automações, quero selecionar funil e depois suas etapas, para distinguir etapas de mesmo nome em funis diferentes.
7. Como pessoa que configura automações, quero selecionar origens e valores UTM disponíveis, para aproveitar os dados já conhecidos pelo CRM.
8. Como pessoa que configura automações, quero escolher campos personalizados pelo nome cadastrado e receber uma entrada coerente com seu tipo, para não escrever identificadores técnicos.
9. Como pessoa que configura automações, quero operadores pertinentes à informação escolhida, para não montar comparações sem sentido.
10. Como pessoa que configura automações, quero entradas adequadas para números, valores monetários, opções e texto, para informar valores corretamente.
11. Como pessoa que configura automações, quero que vazio e preenchido dispensem valor adicional, para completar a regra com menos passos.
12. Como pessoa que configura automações, quero distinguir carregamento, lista vazia, falha e referência removida, para saber como prosseguir.
13. Como pessoa que configura automações, quero preservar escolhas compatíveis ao trocar campo, operador ou funil, para não perder trabalho válido.
14. Como pessoa que configura automações, quero que escolhas incompatíveis sejam limpas com orientação no campo, para corrigir a regra sem modais desnecessários.
15. Como pessoa que configura automações, quero combinar regras com Todas/E, para exigir que todos os critérios sejam satisfeitos.
16. Como pessoa que configura automações, quero combinar regras com Qualquer/OU, para aceitar alternativas comerciais.
17. Como pessoa que configura automações, quero aninhar grupos em até três níveis, incluindo o principal, para expressar combinações sem tornar a estrutura ilegível.
18. Como pessoa que configura automações, quero duplicar ou excluir regras e adicionar grupos, para editar sem repetir trabalho.
19. Como pessoa que configura automações, quero recolher grupos mantendo um resumo fiel, para revisar condições extensas.
20. Como pessoa que configura automações, quero bordas e recuos que indiquem pertencimento sem depender apenas de cores, para compreender grupos com clareza.
21. Como pessoa que configura automações, quero um painel lateral ampliável, para trabalhar com grupos e seletores confortavelmente.
22. Como pessoa que configura automações, quero um título editável e resumo automático legível no canvas, para entender a decisão sem abrir o node.
23. Como pessoa que configura automações, quero salvar rascunhos incompletos e localizar os erros antes de publicar, para trabalhar progressivamente sem afetar o fluxo ativo.
24. Como pessoa que configura automações, quero usar o negócio que iniciou a automação quando disponível, para avaliar o registro correto.
25. Como pessoa que configura automações, quero uma consulta explícita de existência de negócio quando preciso pesquisar outros negócios do lead, para não depender de uma escolha silenciosa.
26. Como pessoa que configura automações, quero que todas as condições de uma consulta de existência correspondam ao mesmo negócio, para não misturar atributos de negociações distintas.
27. Como pessoa que configura automações, quero negócios em aberto como padrão visível nessa consulta, com opções ganhos, perdidos e todos, para controlar o recorte do histórico.
28. Como pessoa que configura automações, quero avaliar dados atuais de lead e negócio após esperas, para decidir com base na situação comercial da avaliação.
29. Como pessoa que configura automações, quero medir Tempo na etapa atual desde a última entrada, para não somar passagens anteriores.
30. Como pessoa que configura automações, quero consultar Última venda ganha pela data do fechamento entre negócios que permanecem ganhos, para usar histórico comercial sem presumir pagamento.
31. Como pessoa que configura automações, quero que a consulta encontre uma venda ganha anterior quando a mais recente for reaberta, ou fique vazia se não houver nenhuma, para não tratar negociação reaberta como venda concluída.
32. Como pessoa que configura automações, quero usar a conversa que iniciou o fluxo, ou selecionar uma caixa explicitamente quando o gatilho não fornecer conversa, para manter o contexto correto.
33. Como pessoa que configura automações, quero que mensagens em outras caixas não mudem a espera avaliada, para evitar misturar WhatsApp, Instagram e outras conversas.
34. Como pessoa que configura automações, quero escolher mensagem do gatilho, última mensagem recebida ou busca em período definido, para comparar o conteúdo pertinente.
35. Como pessoa que configura automações, quero que comparações textuais ignorem maiúsculas e acentos sem alterar a mensagem original, para não criar regras duplicadas.
36. Como pessoa que configura automações, quero distinguir contém palavra ou expressão de contém trecho, para evitar que preço corresponda a apreço por engano.
37. Como pessoa que configura automações, quero adicionar várias expressões na mesma regra com Enter e removê-las individualmente, para reduzir repetição.
38. Como pessoa que configura automações, quero escolher qualquer uma ou todas as expressões e manter expressões compostas como um item, para representar a intenção da busca.
39. Como pessoa que configura automações, quero que todas as expressões exigidas correspondam à mesma mensagem, para não combinar palavras de mensagens diferentes.
40. Como pessoa que configura automações, quero negar a busca como não existe mensagem correspondente, para não confundir ausência de correspondência com existência de uma mensagem diferente.
41. Como pessoa que configura automações, quero buscar no texto, legenda e transcrição já disponíveis, para aproveitar conteúdo existente sem gerar nem aguardar transcrição.
42. Como pessoa que testa condições, quero ver a fonte textual da correspondência, para entender o resultado respeitando meu acesso aos dados.
43. Como pessoa que configura automações, quero distinguir Lead aguardando resposta de Empresa aguardando resposta do lead, para saber quem deve responder.
44. Como pessoa que configura automações, quero contar espera desde a primeira mensagem da sequência sem resposta, para que complementos e follow-ups do mesmo lado não reiniciem o relógio.
45. Como pessoa que configura automações, quero que mensagens enviadas por humano, Copilot ou automação contem como resposta da empresa, para medir troca de mensagens sem julgar seu conteúdo.
46. Como pessoa que configura automações, quero que áudio, imagem e documento contem como resposta mesmo sem texto, para não confundir mídia com silêncio.
47. Como pessoa que configura automações, quero excluir mensagens apenas agendadas, envios com falha e confirmações de leitura ou entrega da contagem de resposta, para não registrar uma resposta inexistente.
48. Como pessoa que configura automações, quero que nenhuma mensagem signifique espera não iniciada, para não tratar ausência como duração zero.
49. Como pessoa que configura automações, quero comparar tempo corrido na primeira entrega, para medir espera sem depender do calendário comercial da segunda entrega.
50. Como pessoa que configura automações, quero que campo vazio só satisfaça está vazio, para não interpretar falta de informação como valor diferente.
51. Como pessoa que configura automações, quero distinguir tag existente não atribuída de tag excluída, para que não tem tag seja uma comparação válida sem esconder configuração quebrada.
52. Como pessoa que opera automações, quero erro claro quando o registro específico ou uma referência necessária foi removida, para corrigir o fluxo sem escolher outro registro silenciosamente.
53. Como pessoa que testa condições, quero avaliar uma configuração com lead e contexto selecionados sem executar ações, para verificar a decisão sem efeitos comerciais.
54. Como pessoa que testa condições, quero resultado por regra e grupo e marcação de não avaliadas, para compreender avaliação abreviada sem resultados inventados.
55. Como pessoa que opera automações, quero que a configuração inteira seja validada antes das comparações, para que referências quebradas não fiquem escondidas em ramos dispensáveis.
56. Como pessoa que opera automações, quero tentativas limitadas para falhas temporárias, reavaliando o node inteiro sem repetir ações anteriores, para tolerar indisponibilidades breves.
57. Como pessoa que opera automações, quero Histórico insuficiente quando lacunas puderem mudar o resultado, para não tomar decisões com dados presumidos.
58. Como pessoa que opera automações, quero que mensagens tardias influenciem avaliações futuras sem reabrir decisões concluídas, para evitar repetir ou contradizer ações.
59. Como administrador da organização, quero autorizar um escopo explícito para a execução automática, para mantê-la independente do criador sem conceder acesso irrestrito.
60. Como administrador da organização, quero nova aprovação quando a edição ampliar acesso, para impedir que autorização anterior seja usada para dados novos.
61. Como pessoa que edita automações, quero ajustar valores e regras dentro do acesso autorizado sem aprovação adicional, para evitar atrito em mudanças que não ampliam escopo.
62. Como pessoa que opera automações, quero que a versão ativa permaneça até a substituta estar válida e autorizada, para não expor edição incompleta à execução.
63. Como pessoa que opera automações, quero que execuções iniciadas preservem sua versão das regras e novas execuções usem a versão publicada, para não mudar decisões no meio do percurso.
64. Como administrador da organização, quero que revogação de acesso alcance execuções em andamento antes de novos acessos, para retirar uma autorização efetivamente.
65. Como pessoa que testa condições, quero que o teste respeite minhas permissões, para não revelar dados restritos nem por um resultado Sim/Não.
66. Como pessoa que consulta execuções, quero que histórico, valores e caminhos respeitem minhas permissões atuais, para não herdar os privilégios da automação.
67. Como pessoa que importa ou duplica automações, quero manter a estrutura das regras e resolver referências no contexto correto, para não reutilizar identidades ou autorizações de outra organização.
68. Como pessoa que já usa automações, quero preservar comportamento legado até migração explícita, para não mudar resultados ao receber a nova interface.
69. Como pessoa que configura automações, quero operar seletores e grupos pelo teclado com foco previsível, para configurar sem depender exclusivamente do mouse.
70. Como pessoa que configura automações, quero nomes precisos para campos de negócio, produtos e atividades, para não confundir relações de domínio diferentes.

## Implementation Decisions

### Escopo e reaproveitamento

- Evoluir o contexto de Workflows, consumindo APIs públicas de Identity, Leads, Pipelines, Communication, Engagement e Carteira. Reaproveitar catálogos, seletores pesquisáveis, validação e infraestrutura de execução existentes quando compatíveis; não criar um segundo motor comercial divergente.
- A primeira entrega inclui o condicional guiado, tempo corrido, versões, autorização, teste, histórico protegido e compatibilidade. Calendários comerciais não são dependência de lançamento dessa entrega.
- O catálogo não deve anunciar capacidade sem fonte e avaliação implementadas. Lacunas de fonte precisam ser resolvidas no trabalho técnico; não autorizam cortar requisitos aprovados silenciosamente.

### Configuração, identidade e publicação

- Representar grupos e regras com identidades estáveis, tipo explícito de dado, operador compatível e referência por identidade quando houver cadastro. O contrato novo deve ser distinguível do legado; seu formato físico será fechado antes da implementação dos consumidores.
- Limitar grupos a três níveis contando o principal. Validar a mesma restrição no servidor, na importação e no editor. Quantidade de regras, itens e custo de consultas ainda exigem limites medidos.
- Campo, operador e funil controlam dependências: limpar apenas escolhas incompatíveis e mostrar orientação junto ao campo. Toda edição fica no rascunho; sem modal de confirmação para essa transição.
- Validar a configuração inteira antes de comparar dados, incluindo referências de ramos que talvez não precisem ser avaliados. Configuração inválida impede publicação e gera erro quando encontrada na execução.
- Depois de validada, a avaliação pode parar quando o resultado for determinado. Condições dispensadas ficam não avaliadas; teste e execução usam a mesma semântica.
- Separar rascunho de publicação. Execuções preservam a versão de regras do início; novas execuções usam a publicada. Capturar vínculo em todos os produtores de execução, não somente no worker. Instante exato diante do enfileiramento e persistência são contratos técnicos a fechar.
- Importação e cópia devem preservar estrutura e resolver referências no destino. Autorização concedida na organização de origem não autoriza execução na organização de destino.

### Avaliação comercial

- Novo condicional decide Sim/Não; espera pertence ao node próprio. O modo de horário legado que pausa fora da janela permanece legado até migração explícita.
- Dados de lead e negócio são atuais no momento da avaliação, sem congelar atributos junto com a identidade do registro do gatilho.
- Usar o sujeito comercial canônico: posição e etapa pertencem ao negócio no funil; não reconstruir etapa a partir de espelhos antigos do lead nem presumir que toda posição possui um registro financeiro associado.
- Consulta de existência tem filtro visível Em aberto por padrão, podendo selecionar ganhos, perdidos ou todos. Todas as comparações do grupo precisam corresponder ao mesmo negócio. O recorte padrão não é aplicado implicitamente ao negócio específico do gatilho.
- Tempo na etapa atual usa última entrada, reiniciando após saída e retorno. Última venda ganha usa último fechamento como ganha entre negócios que permanecem ganhos. Negócio reaberto deixa de ser elegível; buscar anterior ou retornar campo vazio. Não alterar classificação histórica de cliente nem inferir quitação.
- Campo sem valor só satisfaz está vazio. Zero e falso informados não são ausência. Tag cadastrada não atribuída ao lead pode satisfazer não tem tag; cadastro removido é configuração inválida.
- Registro específico removido encerra a execução com erro. Não substituir por outro registro nem transformar impossibilidade de avaliar em Não.

### Conversas, texto e tempo

- Preservar conversa do gatilho como padrão; sem ela, caixa de entrada explícita. Não seguir automaticamente o canal mais recente. Essa regra não altera roteamento de envio existente.
- Oferecer mensagem do gatilho, última recebida e existência de mensagem recebida em intervalo explícito. A regra completa corresponde à mesma mensagem. Negação significa nenhuma mensagem correspondente, com cobertura suficiente para comprovar ausência.
- Comparações textuais ignoram maiúsculas e acentos, preservando o original. Mensagens usam palavra ou expressão como padrão; trecho parcial é uma opção distinta. Várias expressões usam qualquer uma/todas e itens compostos permanecem inteiros.
- Texto, legenda e transcrição já disponível são fontes elegíveis. Identificar fonte no teste sem violar permissões. Não gerar ou aguardar transcrição; ausência de texto em mídia não comprova ausência de palavras no áudio ou imagem.
- Distinguir quem aguarda resposta. Contar desde a primeira mensagem da sequência atual ainda sem resposta; complementos do mesmo lado não reiniciam tempo. Resposta da empresa pode ser humana, Copilot ou automação. Áudio, imagem e documento contam como resposta; agendamento, falha e recibos não.
- Sem mensagens e com ausência comprovada, espera não foi iniciada e condições de espera retornam Não. Isso difere de histórico incompleto ou conversa removida.
- Se uma lacuna relevante puder mudar resultado, retornar Histórico insuficiente. Sincronização em andamento usa tentativas limitadas. Status de job concluído, isoladamente, não comprova cobertura.
- Mensagem tardia entra na ordem cronológica pertinente e influencia avaliações futuras; não reabre decisões já concluídas. Registrar momento da decisão anterior. Fonte de horário e critérios de suficiência exigem contrato técnico.

### Falhas e segurança

- Separar resultado avaliado de configuração inválida, acesso negado/revogado, contexto removido, falha temporária e histórico insuficiente. Nenhum erro vira Não silenciosamente.
- Falha temporária permite tentativas limitadas com intervalos crescentes; cada tentativa recomeça a avaliação inteira com dados atuais. Não repetir ações anteriores, reutilizar resultados parciais ou escolher saída enquanto aguarda. Esgotadas tentativas, erro visível.
- Execução automática tem escopo explícito autorizado pela organização e aprovado por administrador, independente do criador. Saída do criador não revoga por si só essa concessão. Não usar privilégio técnico de serviço como substituto do escopo autorizado.
- Ampliação de acesso exige nova aprovação; edição dentro do acesso autorizado não. A detecção de ampliação e granularidade da concessão precisam ser definidas tecnicamente antes da publicação do contrato.
- Verificar autorização vigente antes de cada acesso. Revogação vale para execuções antigas: ao precisar do acesso, encerrar com erro sem retry automático. Fixar versão de regras não congela permissões.
- Teste usa acesso de quem testa, incluindo seleção e detalhes retornados. Histórico usa permissões atuais de quem consulta. Proteger valores, resultados e caminhos contra exposição direta ou inferência; a proteção ocorre no servidor.
- Preservar isolamento por organização e permissões por recurso. Não introduzir novas roles por conveniência; integrar à estrutura existente.

### Compatibilidade e pré-requisitos técnicos

- Preservar o avaliador legado sob seu contrato; diferenças de ausência, tags, custom por nome, etapas, aliases, regex e horário exigem migração explícita com comparação de significado.
- Não inventar versões históricas de execuções legadas a partir da definição atual. Planejar tratamento e transição antes de publicar o novo comportamento.
- Antes de fechar as fatias dependentes, confirmar fontes e contratos para fechamento ganho, reentrada, produtos, atividades, último contato, cobertura de mensagens e proveniência textual. Limites numéricos de custo, janelas, retry e consistência interna não foram escolhidos na entrevista e não devem ser apresentados como decisões aprovadas.

## Testing Decisions

- **Fronteira principal validada com o CTO:** comportamento público do serviço de avaliar condição. Entram configuração, contexto e identidade autorizada; saem decisão explicada ou erro classificado. Testar por essa fronteira o máximo possível, sem acoplar a testes de helpers privados, ordem de chamadas ou forma física de persistência.
- **Complementos necessários:** E2E do editor e publicação para comportamento que só é observável na interface; integração com banco real de desenvolvimento para isolamento, concessões, versões e retomada. Esses complementos comprovam garantias que mocks do avaliador não demonstram.
- Um bom teste expressa cenário comercial e resultado observável: mesma entrada de negócio, mesma conversa, texto relevante, saída, explicação, erro e efeitos que não devem ocorrer. Mudança interna que preserve contrato não deve quebrar o teste.
- Prior art existente: testes do painel condicional, comparador/evaluador legado, ramos do executor, portabilidade, requisitos de configuração, sujeito comercial, integração de gatilhos/permissões e E2E básico de workflow. Estender essas fronteiras em vez de multiplicar harnesses independentes.
- Cobrir grupos mistos E/OU, três níveis, configuração inválida em ramo dispensável, marcação de não avaliada e referências removidas. Testar tag não atribuída separadamente de tag excluída; campo vazio separadamente de zero e falso.
- Cobrir contexto comercial específico versus existência, mesma entidade em todas as regras, filtro de negócios em aberto, entrada/saída/reentrada de etapa e venda ganha excluída após reabertura.
- Cobrir maiúsculas/acentos, palavra versus trecho, expressões compostas, qualquer/todas, mesma mensagem, negação por período, limites temporais e fonte da correspondência.
- Cobrir sequência sem resposta de ambos os lados, complementos, resposta automática, mídia sem transcrição, ausência comprovada, cobertura insuficiente e chegada tardia sem repetição de efeitos.
- Cobrir erro temporário, nova tentativa com dados alterados, esgotamento, registro removido e revogação sem retry. Comprovar que ações anteriores não são repetidas.
- Cobrir rascunho sem alterar versão ativa, publicação autorizada, execução antiga com regra antiga e dados atuais, execução nova com versão nova e impossibilidade de obter acesso novo sem aprovação.
- Cobrir acesso positivo e negativo por organização e recurso, inclusive teste e histórico que não revelam resultado booleano ou caminho restrito. Negação de acesso precisa ser observável mesmo usando clientes privilegiados no worker.
- E2E verifica seleção real, teclado, foco, grupos recolhidos, resumo fiel, limpeza de dependências, validação no campo e publicação. Não considerar mocks de componentes prova suficiente de acessibilidade.
- Medir consultas representativas antes de fixar limites de regras, duração e janelas. Evitar carregar históricos inteiros ou usar páginas limitadas de UI como prova de ausência.
- Baseline local auditada: 198 testes passaram em seis arquivos na revisão 7ce7fc74, usando dependências já instaladas. Isso não comprova a feature futura, instalação reproduzível pelo lockfile, integração de banco, E2E ou performance de produção.

## Out of Scope

- Segunda entrega: tempo comercial, calendários compartilhados, dias fechados/horário reduzido, vigências prospectivas, arquivamento e permissão própria de manutenção.
- Avaliação semântica por IA, interpretação automática de mídias e geração ou espera por transcrição durante a condição.
- Pagamentos, quitação ou estornos como substitutos de venda ganha.
- Alteração implícita de roteamento de envio, unificação de conversas entre caixas ou reabertura de decisões por mensagens tardias.
- Reescrita silenciosa de fluxos legados, exclusão de dados históricos ou concessão automática de acesso amplo.
- Grupos acima de três níveis na primeira entrega.
- Deploy em produção, migração executada, criação de tickets filhos ou implementação de código nesta etapa de especificação.

## Further Notes

- Este PRD sintetiza brainstorming, grilling e auditoria local; não inicia nova entrevista nem afirma que lacunas técnicas já foram resolvidas. É um épico para decomposição em trabalho dependente, não uma única fatia para implementação direta.
- Base auditada: main em 7ce7fc742e074da8e13c9d3c1261e975f87a42b2. Parte dos seletores e contexto de negócio já foi implementada nessa base. Posição fora do registro financeiro de negócio é arquitetura deliberada; não reconstruir o modelo antigo.
- A auditoria foi local. Aplicação de migrations e disponibilidade real no dev precisam ser verificadas antes das fatias dependentes. Cobertura de sincronização e fonte persistida de transcrição são lacunas de implementação identificadas, não capacidades presumidas.
- Decisões de domínio consolidadas nesta especificação correspondem aos ADRs 0036–0055 desta sessão e ao glossário. O corpo é autossuficiente porque esses documentos locais ainda não foram publicados como commits. A revisão multiagente inicial aprovou o conceito anterior ao grilling, não todos os contratos posteriores.
- Segunda entrega já tem direção aprovada: tempo corrido permanece padrão; comercial exige calendário e fuso explícitos. Calendários são compartilhados na organização, com exceções manuais por data, alterações prospectivas que preservam passado e arquivamento sem quebrar referências. Editores selecionam; manutenção exige permissão própria inicialmente concedida a administradores. Essas decisões devem ser preservadas na futura especificação da segunda entrega.
- A issue #1337 trata cálculo da instância viva para roteamento de envio, não esta experiência condicional. Não foi encontrada uma issue aberta equivalente a este PRD na busca realizada; este trabalho não substitui nem modifica aquela política.
