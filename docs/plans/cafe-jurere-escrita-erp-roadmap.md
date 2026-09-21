# Café Jurerê — planejamento de escrita no ERP Toth

Planejamento inicial: 2026-09-17. Atualização com resposta do fornecedor: 2026-09-21.
Estado: 30 decisões iniciais registradas abaixo, com revisão explícita nesta atualização. O levantamento local e a fundação de rascunhos foram autorizados e implementados, conforme [inventário](cafe-jurere-etapa-0/README.md) e [escopo técnico](../../.specs/features/toth-order-drafts.md). O fornecedor informou criação de pré-pedidos sujeitos à análise e inexistência de homologação na Café. Contrato técnico, catálogo, ambiente isolado e envio real continuam pendentes. A nova informação não autoriza merge, deploy, aplicação de migration ou ativação da funcionalidade.

## Objetivo e limites

Criar pedidos a partir de negócios do Torque, preservando cadastros e pedidos existentes. O plano inicial previa criação, alteração e cancelamento pelo CRM. A resposta de 21/09 limita a capacidade declarada à criação de pré-pedidos; o piloto de inclusão e acompanhamento é a revisão proposta. Alterações/cancelamentos remotos dependem de capacidade futura e não são liberados pela informação de que os bloqueios internos são mais leves. Toda liberação de escrita depende de contrato, homologação e autorização explícita de produção.

Documentos de contexto: `.specs/project/integracao-erp-cafe-jurere-pedido-formal.md`, `.specs/project/toth-plano-sync-cafe-jurere.md` e `.specs/project/toth-o-que-falta.md`. São registros históricos, não comprovação do estado atual do fornecedor ou da implantação.

## Atualização de 21/09/2026

Fonte e limites: [resposta encaminhada do fornecedor](cafe-jurere-etapa-0/resposta-fornecedor-2026-09-21.md). O técnico ressalvou que a configuração exata da Café ainda precisa ser confirmada.

| Ponto | Estado atual | Efeito no planejamento |
|---|---|---|
| Gatilho de ganho — revisão da decisão 14 | **Confirmado pelo usuário em 21/09: após aprovação no ERP, com status confirmado pela integração.** | Recebimento do pré-pedido não gera ganho; faturamento é evento distinto. Consulta/status ausente ou desconhecido não confirma aprovação. |
| Objeto da escrita — decisão 3 | Fornecedor declara pré-pedido sujeito à análise; pedido definitivo na inclusão não foi oferecido | Adaptar a primeira escrita para pré-pedido, preservando a decisão inicial como histórico e confirmando o escopo do piloto com o usuário. |
| Primeiro piloto — decisões 8, 19 e 23 | **Proposta submetida ao usuário:** inclusão de pré-pedido e acompanhamento; comandos de alteração/cancelamento/rejeição fora da primeira liberação | Não implementar esses comandos enquanto não houver capacidade e contrato seguro. A resposta não declara endpoint para pedir rejeição. |
| Homologação — atualização factual da decisão 24 | Não existe na Café; fornecedor instala se houver VM | Solicitar requisitos, responsabilidades, licenças, custo, prazo e isolamento antes de contratar/provisionar. |
| Duplicidade e consulta — decisões 12 e 22 | “Sim” informado, sem mecanismo, rota ou exemplos | Continuam pendentes até contrato e teste de concorrência/resposta perdida. |
| Rejeição antes da aprovação — decisões 13 e 15 | Fluxo novo ainda não decidido | Não confundir rejeição com cancelamento de venda; não assumir perda automática, estorno ou permissão para reenviar no mesmo negócio. |
| Mudanças pela empresa — decisões 16 e 17 | Necessárias ao processo informado | Acompanhar total aprovado, ajustes e cancelamentos dos pedidos originados pela integração, sem alterar regras históricas nem duplicar efeitos. |

A base local de rascunhos permanece compatível: conferência local não aprova comercialmente, não escreve no ERP e não altera o desfecho. A decisão atual sobre ganho substitui a regra original de ganho na criação; demais pontos de produto não confirmados permanecem propostas ou pendências.

Após a solicitação “Faça a implementação”, foi construída a persistência de operações, o processador interno, o acompanhamento no painel e a conciliação do ganho confirmado pelo caminho canônico do CRM. A importação legada possui proteção específica para IDs dessas operações novas. Testes locais exercitam o fluxo com fornecedor fictício; a admissão SQL e o adaptador real permanecem fechados. Não há homologação nem envio real liberado. Detalhes e limites: [runbook de implementação](../operations/toth-preorder-processing.md).

Esta entrega não encerra as decisões 15–17: divergências posteriores à aprovação exigem conferência, sem ajuste automático, estorno ou nova venda. Rejeição antes de aprovar também não marca perda automaticamente. A liberação desses comportamentos depende do contrato real e das decisões ainda pendentes.

## Decisões de 17/09/2026 — registro histórico

A tabela preserva as respostas originais. Para execução, considerar as atualizações de 21/09 acima; em particular, a decisão 14 original foi substituída e a hipótese de pedido definitivo da decisão 3 não corresponde à capacidade informada pelo fornecedor.

| # | Decisão |
|---|---|
| 1 | Começar por pedidos para clientes já cadastrados no ERP. |
| 2 | Envio manual após revisão por usuário autorizado. |
| 3 | Criar pedido definitivo, sujeito à confirmação dos efeitos operacionais no Toth. |
| 4 | Somente administradores da organização enviam pedidos ao ERP. |
| 5 | Preços, descontos e condições seguem o ERP, sem edição livre no CRM. |
| 6 | Catálogo sincronizado do ERP; revalidar antes do envio e exigir nova revisão se houver mudanças. |
| 7 | Pedido nasce de um negócio, com rascunho salvo no CRM; salvar não escreve no ERP. |
| 8 | Escopo completo inclui criação, alteração e cancelamento pelo CRM. |
| 9 | Alteração e cancelamento limitados aos pedidos criados pela nova integração; históricos e pedidos criados diretamente no ERP são somente consulta. |
| 10 | Alterar e cancelar somente antes do processamento operacional; situação desconhecida bloqueia a operação. Mapear estados e vínculos impeditivos com o fornecedor. |
| 11 | Mudança direta no ERP bloqueia a operação até atualização dos dados e nova revisão; nenhuma sobrescrita automática. |
| 12 | Resposta incerta gera “Aguardando confirmação”; consultar o ERP antes de liberar nova tentativa. Sem resultado conclusivo, manter bloqueado para conferência. |
| 13 | Um único pedido por negócio. Após cancelamento, um substituto exige outro negócio. |
| 14 | Criação confirmada no Toth marca o negócio como ganho. Resposta incerta não muda o desfecho. |
| 15 | Cancelamento confirmado reabre o negócio e reverte seus efeitos nos indicadores, preservando histórico. Não libera outro pedido no mesmo negócio. |
| 16 | Alteração confirmada do total ajusta valor do negócio e indicadores pela diferença, sem contar outra venda. |
| 17 | Alterações e cancelamentos diretos no Toth refletem os mesmos efeitos no CRM após confirmação pela sincronização, apenas para pedidos da nova integração, sem repetição de efeitos. |
| 18 | Empresa/filial e representante derivam de vínculos válidos no ERP; ausência ou ambiguidade bloqueia envio. Quem envia não é presumido como representante. |
| 19 | Alterações abrangem itens, quantidades e condições comerciais válidas. Cliente, empresa/filial e representante ficam fixos após criação. |
| 20 | Endereço de entrega e frete seguem opções e regras do ERP; sem preenchimento livre. Ausência de dados obrigatórios bloqueia envio. |
| 21 | Respeitar bloqueios de crédito, inadimplência e estoque do ERP, sem exceção local. |
| 22 | Contrato da API de escrita ainda não validado; começar pela confirmação com o fornecedor. |
| 23 | Liberar em etapas: criação → alteração → cancelamento, cada uma com homologação e critérios próprios. |
| 24 | Existência de ambiente de homologação do Toth ainda desconhecida. |
| 25 | Piloto com um administrador designado, poucos pedidos e conferência individual no ERP. |
| 26 | Motivo obrigatório em alterações e cancelamentos; registrar autoria, mudanças e resultado. |
| 27 | Se o ERP confirmar e o CRM falhar, registrar “Sincronização pendente” e recuperar apenas efeitos locais; não reenviar ao ERP. Avisar administrador se persistir. |
| 28 | Usuários com acesso ao negócio e permissão específica preparam rascunhos; envio continua exclusivo de administradores. |
| 29 | Mudança no rascunho invalida a revisão; enviar exatamente a versão conferida. |
| 30 | Capacidade de segurança ausente bloqueia a operação afetada até solução validada com o fornecedor; interface e simulação podem avançar quando o desenvolvimento for autorizado. |

## Roadmap de implementação proposto

Revisão após a resposta de 21/09. O formato do primeiro piloto foi submetido ao usuário e permanece proposta até confirmação; o gatilho de ganho após aprovação já está confirmado.

### Etapa 0 — contrato, ambiente e levantamento do estado existente

- Inventariar código, sincronizações e regras atuais do CRM em leitura; identificar como negócios ganhos, ajustes de valor e reversões afetam os indicadores. Reaproveitar as regras existentes sem criar uma segunda fonte de venda.
- Priorizar contrato de criação de pré-pedido, consulta de resultado e acompanhamento da análise; separar serviços disponíveis dos que precisam ser desenvolvidos no Flow. Registrar ausência atual de alteração/cancelamento e requisitos futuros, sem tratá-los como endpoints existentes.
- Especificar e preparar homologação isolada do ERP com fornecedor e responsável pela infraestrutura, credenciais próprias e dados de teste. Não há ambiente da Café hoje; uma VM ou um ambiente isolado do CRM não garantem isolamento dos efeitos do Toth.
- Confirmar produtos, preços, descontos, condições, endereço, frete, empresa, representante e validações comerciais.
- Mapear separadamente os efeitos de recepção, análise, aprovação e rejeição, além de posteriores ajustes/cancelamentos, sobre estoque, cobrança, faturamento e expedição.
- Validar identificação única de operações, consulta de resultados após timeout e proteção contra mudanças simultâneas. Ler antes de gravar, sozinho, não elimina a corrida entre leitura e gravação.
- Reavaliar transporte e credenciais para escrita: os documentos históricos registram HTTP aceito para leitura. Isso não confirma a configuração atual nem estende automaticamente aquela decisão ao novo poder de escrita. Definir canal protegido e permissões mínimas para o novo escopo.
- Confirmar como detectar mudanças diretas no ERP e escolher frequência de reconciliação conforme limites e necessidade operacional.

Saída: matriz de capacidades com evidências, campos e regras definidos, ambiente confirmado e dependências atribuídas. Operação sem garantia essencial permanece bloqueada. Não estimar prazo firme antes dessa saída.

### Etapa 1 — fundação de segurança e rascunhos

- Modelar rascunho versionado, vínculo exclusivo negócio/pedido, origem verificável e registro persistente das operações.
- Aplicar escopo da organização e permissões no servidor; preparar não equivale a enviar. Definir a matriz das ações de alteração e cancelamento antes de implementá-las, mantendo as escritas restritas a administradores como proposta a confirmar.
- Sincronizar catálogo e vínculos, preparar revisão de totais e validar versão no envio.
- Separar situação do pedido, situação da operação e situação da sincronização local.
- Definir auditoria, processamento sem duplicidades, recuperação de falhas e interrupção de novos envios.
- Simular localmente sem chamar endpoints de escrita do ERP.

Saída: rascunhos e proteções validados, sem escrita real. Testes positivos e negativos de autorização e isolamento entre organizações.

### Etapa 2 — pré-pedido, acompanhamento e primeiro piloto proposto

- Implementar envio manual de pré-pedido com valores e referências válidos no ERP, após confirmação do escopo do piloto.
- Persistir identificação da operação antes de enviar; vincular o pré-pedido recebido e sua relação com eventual pedido aprovado. Resolver previamente a regra de correção/substituição após rejeição; não presumir autorização para uma segunda submissão no mesmo negócio.
- Separar recebimento técnico de análise comercial. Marcar o negócio como ganho somente após aprovação confirmada no ERP, uma única vez, com total autorizado; recuperar falhas locais sem reenviar ao Toth.
- Exibir rejeição e motivo confirmado, sem presumir perda ou cancelamento de venda. Estado ausente/desconhecido e análise pendente não permitem contabilizar venda. Os efeitos de rejeição sobre o negócio e a política de substituição ainda precisam de decisão.
- Tratar resposta perdida, clique duplo, concorrência e indisponibilidade com confirmação e reconciliação.
- Implementar já nesta etapa a leitura de alterações/cancelamentos feitos diretamente no Toth para esses pedidos, pois a equipe poderá corrigi-los no ERP durante o piloto.
- Homologar e, após autorização explícita, iniciar piloto com um administrador e conferência individual.

Saída: pré-pedido, aprovação comercial e negócio conciliados, valores e indicadores corretos, nenhuma modificação em cadastros ou pedidos preexistentes. A proposta de criação não depende da liberação dos comandos de alteração/cancelamento, mas depende de acompanhar decisões e mudanças realizadas pela empresa no ERP.

### Etapa 3 — alteração remota, condicionada a capacidade futura

Não oferecida na resposta atual. Somente retomar desenvolvimento/liberação após confirmação de API e proteção atômica contra sobrescrita. Edição pela empresa e eventual pedido humano de rejeição não são equivalentes a uma API de alteração.

- Permitir somente o escopo confirmado: itens, quantidades e condições válidas.
- Exigir motivo, origem comprovada, estado elegível e proteção de concorrência no momento da gravação.
- Revalidar regras comerciais; conflito exige atualização e nova revisão.
- Ajustar valor e indicadores apenas após confirmação, uma única vez por mudança.

Saída: alteração homologada, inclusive disputa com edição direta no ERP, sem sobrescrita e sem duplicação de venda.

### Etapa 4 — cancelamento remoto, condicionado a capacidade futura

Não oferecido na resposta atual. Somente retomar após contrato e garantias suficientes. Rejeição comercial de pré-pedido e cancelamento de pedido/venda precisam de estados e efeitos distintos.

- Exigir motivo, origem comprovada, estado elegível e confirmação explícita da ação na interface.
- Aguardar confirmação do Toth antes de reabrir negócio e reverter indicadores.
- Preservar pedido, histórico e vínculo; impedir reutilização do negócio para outro pedido.

Saída: cancelamento e efeitos locais homologados; repetição e resposta perdida não geram reversões duplicadas.

### Etapa 5 — ampliação e operação assistida

- Expandir uso após aceite do piloto e evidências de conciliação.
- Disponibilizar pendências de confirmação, conflitos e sincronização para administradores.
- Documentar resposta a incidentes e conferência manual, responsáveis e critérios de interrupção.
- Interromper novas escritas não deve desligar leitura e reconciliação de operações já enviadas.
- Não tratar desligamento como reversão: pedidos confirmados exigem os procedimentos válidos do ERP.

## Testes de aceite obrigatórios

- Pedidos históricos, cadastros e pedidos de outra origem recusam alteração e cancelamento mesmo por chamada direta ao servidor.
- Membro sem autorização, usuário sem acesso ao negócio e usuário de outra organização não conseguem executar ações indevidas.
- Recebimento confirmado de pré-pedido não marca ganho. Só a aprovação comercial confirmada usa o total autorizado e concilia a venda uma vez.
- Análise pendente, rejeição e status ausente/desconhecido não criam venda. Rejeição anterior à aprovação não dispara a regra de estorno de cancelamento.
- Clique duplo, envio concorrente, repetição de eventos e reinício do processo não criam pedidos ou efeitos comerciais duplicados.
- ERP grava e perde resposta: confirmar o resultado antes de qualquer nova tentativa.
- ERP confirma e CRM falha: recuperar apenas a atualização local.
- Mudança direta no ERP ou no rascunho invalida revisão antiga; proteger também a janela entre validar e gravar.
- Estado impeditivo, vínculo ambíguo, produto inválido, regra comercial recusada e ERP indisponível impedem envio.
- Mudanças de total e cancelamentos afetam indicadores uma única vez, inclusive quando originados diretamente no Toth.
- Negócio já ganho antes do envio não pode contabilizar uma segunda venda; mapear esse cenário no levantamento das regras atuais.
- Eventos atrasados ou fora de ordem não podem restaurar uma versão antiga nem desfazer um cancelamento confirmado.

## Pendências para fechar o desenho técnico

Do fornecedor: disponibilidade versus desenvolvimento de APIs no Flow; contrato de criação/consulta, estados/IDs de pré-pedido e pedido aprovado; garantia de duplicidade; catálogo e configuração efetiva da Café; efeitos por fase; especificação da VM, transporte e permissões. Ver [complemento pronto para encaminhamento](cafe-jurere-etapa-0/complemento-fornecedor-2026-09-21.md). Garantias de atualização concorrente seguem pendentes para comandos remotos futuros.

Do usuário/operação: confirmar o piloto de pré-pedidos e acompanhamento; definir tratamento da rejeição, correção/substituição e vínculo exclusivo por negócio; indicar quem aprova/confere na empresa e quem responde pela infraestrutura. O gatilho de ganho após aprovação já foi confirmado e não precisa ser perguntado novamente.

Da Café Jurerê/CTO: nome do administrador do piloto, amostra e duração, critérios quantitativos de aceite, responsáveis por conferência/incidentes e autorização de produção. Confirmar explicitamente a aplicação da restrição a administradores também às ações de alteração e cancelamento, cuja pergunta original tratou do envio de pedidos.

Da engenharia após autorização: levantamento do código atual, desenho técnico, estados e transições detalhados, estratégia de reconciliação, frequência/alertas e estimativas por etapa. Nenhuma lacuna acima autoriza presumir capacidade da API.
