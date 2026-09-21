# Resposta da Toth — 21/09/2026

Fonte: mensagem do fornecedor encaminhada pelo usuário nesta conversa, com horários de 10:17 e 10:18. Registro resumido, sem telefone do remetente ou credenciais. Não houve contato do agente com o fornecedor, chamada à API ou verificação no ERP.

O próprio fornecedor ressalvou que as respostas são superficiais, dependem da configuração de cada cliente e que não conhece exatamente a configuração atual da Café Jurerê. Portanto, declaração de capacidade não equivale a contrato técnico, disponibilidade no ambiente da Café ou homologação.

## O que foi informado

| Pergunta | Resposta recebida, em resumo | Alcance e pendência |
|---|---|---|
| 1. APIs de escrita | Somente criar. Pedidos de API são pré-pedidos, analisados financeira e comercialmente na empresa, depois aprovados ou rejeitados. Edição deve ser feita pela empresa ou passar por solicitação de rejeição. | O objeto criado não é um pedido comercial já aprovado. Não foram entregues rotas, schemas ou exemplos. Não foi declarado endpoint para solicitar rejeição. |
| 2. Homologação | A Café Jurerê não possui. O fornecedor se dispõe a instalar se disponibilizarem uma VM. | Ambiente a construir. Faltam requisitos, licença, custo, responsável, prazo, dados de teste e comprovação de isolamento. Uma VM, sozinha, não comprova isolamento dos efeitos do ERP. |
| 3. Dados comerciais | Existe tabela de preço. A tag `atendimentos` da API de clientes já deve conter as informações relacionadas ao cliente. | Existência declarada, contrato não fornecido. O “já deve” não confirma cobertura de empresa, filial, representante, condição, endereço ou frete. Solicitar exemplos e regras de seleção. |
| 4. Validações e efeitos | Há análise de crédito, dinâmica e definida pelo cliente. | Não confirma a configuração da Café, o momento da análise, estoque, inadimplência ou efeitos da criação/aprovação/rejeição. |
| 5. Duplicidade e resposta perdida | Resposta conjunta: “Sim”. | Alegação sem mecanismo demonstrado. Faltam campo da chave/referência, unicidade atômica, consulta, concorrência, retenção e comportamento com conteúdo diferente. |
| 6. Proteção de sobrescrita | Não há versão do pedido para recusar alteração concorrente. | Sem controle remoto de versão declarado. Não implementar atualização automática baseada apenas em ler antes de gravar. |
| 7. Estados de alteração/cancelamento | A Café não usa PCP no sistema; por isso os bloqueios são mais leves. | Não há matriz de estados ou efeitos confirmada. Ausência de PCP não cria APIs de alteração/cancelamento nem prova ausência de vínculos fiscais, financeiros ou de estoque. |
| 8. Acesso | Não há homologação; será preciso criar serviços no padrão Flow, com token e paginação. Serviço que permite alteração pode ser executado por usuário com acesso. | Há ambiguidade entre “somente criar” e “teremos que criar todas”: confirmar o que existe, o que falta desenvolver e em qual ambiente. URL protegida, autenticação, escopos e credenciais dedicadas seguem pendentes. Token e paginação não demonstram permissões mínimas. |

## Decisão confirmada pelo usuário nesta conversa

Em 21/09/2026, à pergunta sobre quando marcar o negócio como ganho, o usuário escolheu **“A — Após aprovação no ERP”**, com o status confirmado pela integração. Isso revisa a decisão 14 do planejamento de 17/09.

- Confirmação técnica de recebimento do pré-pedido não marca ganho, não gera nova venda e não significa aprovação comercial.
- Aprovação comercial confirmada é o gatilho do ganho. Código/valor do status, fonte de consulta, identidade do pedido aprovado e total autorizado ainda precisam de contrato.
- Faturamento permanece um evento distinto; não foi escolhido como gatilho obrigatório do ganho.
- Estado ausente, desconhecido, resposta perdida ou análise ainda pendente não serão interpretados como aprovação pela nova integração.
- Recuperação de efeitos locais após aprovação não poderá reenviar o pré-pedido nem duplicar vendas, inclusive para negócio já ganho por outro fluxo.

## Consequências para o roadmap

1. **Fundação local existente preservada.** Rascunhos, permissões, conferência local, revisão e auditoria continuam úteis. O envio permanece bloqueado. Nenhum código operacional foi alterado a partir desta resposta.
2. **A primeira escrita proposta passa a ser envio de pré-pedido.** O escopo de criação e acompanhamento foi submetido ao usuário e ainda aguarda confirmação; o gatilho de ganho após aprovação já foi confirmado. Esse desenho requer recebimento confirmado, acompanhamento da análise e conciliação da aprovação com o CRM. Recebimento e aprovação devem ser estados separados da execução técnica e da recuperação local.
3. **Alterar e cancelar pelo CRM ficam condicionados a nova capacidade do fornecedor.** A necessidade de negócio permanece registrada; essas ações não entram no piloto enquanto não houver contrato e garantias. Não substituir endpoints ausentes por escrita direta no banco ou edição automatizada da tela do ERP.
4. **Mudanças dentro da empresa continuam relevantes ao piloto.** A integração precisará acompanhar aprovação, rejeição, ajustes e cancelamentos dos registros que originou. Falta saber como consultá-los, inclusive após mudança de total ou transformação de pré-pedido em pedido.
5. **Homologação é uma frente compartilhada.** TI/Café define quem fornece a VM após especificação; Toth instala/configura o ERP e serviços; engenharia constrói o cliente de integração e os testes. Não foi autorizada contratação ou criação de infraestrutura.
6. **A etapa 0 continua aberta.** A resposta esclarece o processo comercial, mas não entrega o contrato de criação/consulta, a garantia de duplicidade, o catálogo nem o ambiente necessário para liberar escrita.

## Decisões ainda abertas

- Rejeição comercial do pré-pedido não foi definida como perda do negócio nem como cancelamento de venda. Não alterar automaticamente o desfecho com base nessa suposição.
- A regra anterior de um único pedido por negócio não autoriza reenvio após rejeição. Confirmar identidade do pré-pedido/pedido e decidir como tratar correção, substituição e eventual novo negócio, mantendo rastreabilidade e prevenção de duplicidade.
- Pedido de rejeição pode ser um procedimento humano; responsável, canal, motivo e retorno ainda não foram definidos. Não existe endpoint declarado para essa solicitação.
- Confirmar se aprovação pode ser revertida, se pedido pode ser alterado depois de aprovado e quais eventos/valores devem ser conciliados. Não aplicar a regra de cancelamento a uma simples rejeição anterior à aprovação.

Próximo contato proposto: [complemento técnico ao fornecedor](complemento-fornecedor-2026-09-21.md). Estado das capacidades: [matriz atualizada](matriz-capacidades.md).
