# Matriz de capacidades — contrato de escrita a validar

Levantamento inicial: 2026-09-17. Atualização: 2026-09-21. **Nenhuma capacidade de escrita remota está homologada nesta etapa.** Evidências: [inventário local](README.md) e [resposta encaminhada do fornecedor](resposta-fornecedor-2026-09-21.md). Distinguir capacidade declarada, ausência declarada e comportamento demonstrado; resposta parcial não encerra a pendência técnica.

| ID | Capacidade requerida | Evidência disponível / lacuna | Evidência de aceite a solicitar | Bloqueia |
|---|---|---|---|---|
| C01 | Receber pré-pedido preservando cadastros | Fornecedor informa somente criação de pré-pedido, sujeito à análise; existência da rota na Café ainda ambígua | Distinguir serviço existente/dependente de desenvolvimento; método, rota, schema, transação, ID, estado inicial e efeitos; referências existentes não podem atualizar cadastro implicitamente | Criação |
| C02 | Identidade e origem | Referência única alegada na resposta conjunta sobre duplicidade; não demonstrada | Escopo empresa/filial, referência pesquisável e imutável; relação entre IDs de pré-pedido e pedido aprovado | Criação e conciliação |
| C03 | Duplicidade de envio | Fornecedor respondeu “Sim”, sem descrever mecanismo; dedup da importação local não cobre envio | Campo e unicidade atômica da operação; concorrência, retenção e mesma chave com conteúdo diferente | Criação e repetição segura |
| C04 | Resultado após timeout | Mesmo “Sim” responde também à consulta; nenhuma rota/exemplo | Consulta por referência da operação, estados técnicos e consistência; distinguir ausência temporária de falha definitiva, sem confundir recebimento com aprovação comercial | Criação e recuperação |
| C05 | Atualização concorrente | **Ausência declarada:** não há versão do pedido contra sobrescrita | Nova garantia atômica de concorrência antes de permitir futuras alterações/cancelamentos; ler antes de gravar não basta | Futuras alterações/cancelamentos; não é evidência de impossibilidade de criação |
| C06 | Produtos e preço autorizado | Tabela de preço declarada; sem contrato de catálogo ou aplicação por cliente | Ativos, unidades/conversões, tabela aplicável, preços/descontos, validade e validação em cada fase | Criação |
| C07 | Condições, endereço e frete | Fornecedor aponta informações de cliente em `atendimentos`, sem confirmar cobertura | Exemplos e consultas complementares; IDs por cliente, endereço, transportadora, frete, tributos, arredondamento e total final | Criação |
| C08 | Empresa e representante | Mapeador possui atendimentos; fornecedor diz que a tag “já deve” conter as informações | Confirmar campos, escopo e seleção inequívoca para a Café; resolver ambiguidades sem editar cadastro | Criação |
| C09 | Crédito, inadimplência e estoque | Análise de crédito dinâmica declarada; configuração da Café e demais regras não confirmadas | Validar com operação/fornecedor o que ocorre na inclusão e na aprovação; recusas e efeitos de estoque, financeiro, fiscal e expedição | Homologação e piloto |
| C10 | Estado elegível para edição/cancelamento | Ausência de PCP declarada, sem tabela de estados ou vínculos | Matriz real de ações por estado e vínculos; ausência de PCP não libera comandos remotos | Futuras alterações/cancelamentos |
| C11 | Editar pedido e itens | **Não oferecido na resposta:** somente criar; empresa edita ou recebe solicitação de rejeição | Nova capacidade/contrato para edição remota; esclarecer também o procedimento humano, sem presumir API de solicitação de rejeição | Alteração pelo CRM, fora do piloto proposto |
| C12 | Cancelar pedido | **Não oferecido na resposta:** somente criar; rejeição não foi definida como cancelamento | Contrato específico se vier a existir; consulta de resultado, motivos e efeitos. Fluxo humano e estados precisam ser documentados | Cancelamento pelo CRM, fora do piloto proposto |
| C13 | Mudanças diretas no ERP | Edição pela empresa é parte do processo informado; sync atual usa janela padrão de 90 dias | Consulta exata/incremental de análise, aprovação/rejeição, ajustes e cancelamentos; histórico antigo, consistência, identidade e ordenação | Piloto de criação também |
| C14 | Autenticação/transporte | Padrão Flow com token/paginação informado; serviços precisam ser esclarecidos/criados; sem URL segura ou escopos | Canal protegido, credencial dedicada, expiração e lista mínima de ações permitidas; token/paginação não provam isolamento de escrita | Todas |
| C15 | Homologação isolada | **Inexistência declarada na Café.** Toth oferece instalação condicionada a VM | Requisitos/licenças/custo/prazo/responsáveis; ambiente, dados e credenciais próprios; isolamento de efeitos e integrações externas demonstrado | Validação de escrita |
| C16 | Operação e limites | Paginação mencionada; limites e frequência não confirmados | Rate limit, timeout, retry-after, manutenção, incidentes e frequência de acompanhamento | Dimensionamento/piloto |
| C17 | Aprovação comercial confirmada | Fornecedor descreve análise/aprovação/rejeição; usuário escolheu ganho somente após aprovação no ERP | Valores exatos dos estados, fonte da consulta, ID do pedido aprovado, total autorizado e mudanças posteriores; estado ausente/desconhecido não aprova | Ganho e conciliação do piloto |

## Contrato de campos a devolver

Para cada campo, o fornecedor deve informar: nome exato, tipo, obrigatório/condicional, limite, formato, valores válidos, origem, efeito de omissão/null e possibilidade de alteração. Não propomos nomes de payload antes do contrato.

| Grupo | Conteúdo mínimo |
|---|---|
| Operação | ID de correlação, chave de idempotência, identificação do integrador e resultado técnico; motivo/versão esperada para comandos futuros, se suportados |
| Pré-pedido e pedido | IDs estáveis e relação entre eles, empresa/filial, cliente, representante, estado comercial e timestamps com fuso; não presumir revisão remota disponível |
| Comercial | Condição de pagamento, moeda, tabela de preço, descontos autorizados, tributos e arredondamento |
| Entrega | Endereço válido, modalidade/valor do frete, transportadora quando exigida |
| Itens | ID da linha, produto, unidade, quantidade, preço validado, descontos, tributos e total |
| Resultado | Recebimento técnico, falha/resultado incerto separados de análise, aprovação e rejeição comercial; códigos, motivo, IDs e totais canônicos |

## Casos que o contrato precisa permitir homologar

1. Dois envios simultâneos da mesma operação produzem um único pré-pedido.
2. Mesma chave com payload diferente é recusada, não reaproveitada silenciosamente.
3. ERP grava e a resposta se perde; consulta recupera o pré-pedido sem nova criação.
4. Recebimento do pré-pedido não gera ganho. Aprovação confirmada concilia ganho/total uma única vez, inclusive ao recuperar falha local, sem reenviar ao ERP.
5. Análise pendente, rejeição comercial e estado ausente/desconhecido não geram venda; rejeição anterior à aprovação não dispara estorno de uma venda não reconhecida por esta integração.
6. Um item é inválido; não resta pedido parcialmente gravado nem efeito operacional parcial sem representação explícita.
7. Ajustes, aprovação/rejeição e cancelamento realizados pela empresa são consultáveis; consultas repetidas ou atrasadas não duplicam venda nem aplicam um estado antigo como se fosse atual.
8. Mudança tardia de pedido antigo é recuperável fora da janela normal.
9. Credencial expirada ou sem permissão não executa a operação; especificar status e corpo.
10. Inclusão com cliente/produto existente preserva os respectivos cadastros.

Registrar em cada evidência: versão do contrato, ambiente, data, responsável, entrada fictícia, resultado esperado/observado e IDs sem segredos. Não executar esses casos em produção nesta etapa.

Reservados para eventual API futura de alteração/cancelamento: disputa com edição na tela do ERP, mudança simultânea para estado impeditivo, atualização integral ou rollback, motivo e repetição sem duplicar efeitos. Não são capacidades oferecidas pela resposta atual nem comandos liberados para o piloto.
