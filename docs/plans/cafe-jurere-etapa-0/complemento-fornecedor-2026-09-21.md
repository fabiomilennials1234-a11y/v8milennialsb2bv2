# Complemento à Toth — pré-pedidos e homologação

Rascunho para o responsável encaminhar. Não enviado pelo agente. Base: respostas encaminhadas em 21/09/2026.

Olá! Obrigado pelos esclarecimentos. Estamos ajustando o planejamento para **pré-pedidos**, acompanhando a análise na empresa. No CRM, o negócio será marcado como ganho apenas após confirmação da aprovação no ERP. Propomos um primeiro piloto de criação e acompanhamento, considerando a limitação informada para alterações e cancelamentos via API.

Para fechar a implementação e preparar a homologação, precisamos destes detalhes:

1. **Serviços disponíveis e contrato.** Quando dizem “somente criar” e “teremos que criar todas”, a criação já existe e só precisa ser disponibilizada no Flow, ou também será desenvolvida? Listem o que existe e o que falta para autenticação, criação de pré-pedido, consulta de resultado/situação, produtos e tabelas de preço. Enviem métodos, rotas, campos obrigatórios, respostas e erros com exemplos fictícios, responsável e previsão.

2. **Acompanhamento e aprovação.** Como consultar um pré-pedido pelo ID ou pela referência enviada pelo CRM? Quais campos e valores indicam análise, aprovação e rejeição, e como obter motivo, data de atualização e total aprovado? Ao aprovar, o pré-pedido mantém o mesmo ID ou gera outro pedido? Como detectar ajustes e cancelamentos feitos pela empresa, inclusive em pedidos antigos, sem perder a ligação com nossa referência? Informem os limites/frequência permitida para essa consulta.

3. **Duplicidade e resposta perdida.** Qual campo recebe nossa identificação única da operação e como consultá-la se a resposta se perder? Dois envios simultâneos com a mesma identificação devem produzir um único pré-pedido. Precisamos do comportamento com a mesma identificação e conteúdo diferente, tempo de retenção e como distinguir processamento pendente de ausência definitiva. Podem fornecer exemplos e demonstrar esses casos em homologação?

4. **Tabela de preço e `atendimentos`.** Enviem exemplos sem dados sensíveis das respostas de produtos ativos, tabela de preço e cliente com `atendimentos`. Precisamos identificar quais campos fornecem empresa/filial, representante, tabela aplicável, unidades, preços, descontos e condições permitidas, endereço e frete; quais consultas completam as informações que não estiverem em `atendimentos`? Como escolher quando há mais de uma opção e como são calculados/validados os totais?

5. **Configuração efetiva da Café Jurerê.** Com a operação da empresa, confirmem o que é validado na inclusão do pré-pedido e o que só ocorre na aprovação: crédito, inadimplência, estoque e condições comerciais. Quais efeitos cada etapa e a rejeição produzem em estoque, financeiro, faturamento e expedição? A inclusão por API pode alterar algum cadastro existente? Precisamos preservar esses cadastros e registrar claramente o resultado de cada fase.

6. **Correções e rejeição.** A solicitação de rejeição é feita por atendimento humano, por alguém na empresa ou há uma API específica? Quem confirma o resultado e informa o motivo? Após rejeição, o registro permanece consultável e pode ser corrigido, ou é necessário criar outro pré-pedido com novo ID/referência? Há aprovação parcial ou reversão de aprovação? Precisamos desse fluxo para definir a correção sem gerar duplicidades ou contar uma venda indevida.

7. **VM, isolamento e acesso.** Enviem a especificação da VM: sistema operacional, CPU, memória, disco, banco/versão, licenças, rede/acesso, responsável por instalação e manutenção, custo e prazo. Confirmem como isolar dados e integrações para que testes não produzam movimentos, cobranças, documentos fiscais ou notificações reais. Precisamos também da URL com canal protegido, autenticação/expiração e usuário dedicado com acesso apenas às operações necessárias. Credenciais devem seguir por canal seguro. Informem quais serviços o usuário poderá executar, incluindo eventual permissão de alterar cadastros.

Com essas informações, organizamos a infraestrutura com o responsável da Café e os testes de criação, confirmação, aprovação/rejeição e recuperação após falha de comunicação. Nenhum teste de escrita será feito na base real como substituto da homologação.
