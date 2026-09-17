# Matriz de capacidades — contrato de escrita a validar

Data: 2026-09-17. **Nenhuma capacidade de escrita remota está homologada nesta etapa.** Estado “pendente” significa não demonstrado, não indisponível. Evidência local: [inventário](README.md).

| ID | Capacidade requerida | Evidência disponível / lacuna | Evidência de aceite a solicitar | Bloqueia |
|---|---|---|---|---|
| C01 | Criar pedido definitivo sem alterar cadastros | Só leitura remota implementada nos arquivos Toth examinados | Método, rota, schema, transação, ID retornado e efeitos; enviar código existente não pode atualizar cadastro implicitamente | Criação |
| C02 | Identidade e origem | Importação identifica org/origem/número; sem correlação de comando demonstrada | IDs estáveis com escopo de empresa/filial; referência externa pesquisável e imutável | Todas |
| C03 | Duplicidade de envio | Dedup local da importação não protege criação no ERP | Chave de idempotência ou referência única atômica; concorrência; retenção; mesma chave com conteúdo diferente | Criação e repetição segura |
| C04 | Resultado após timeout | Clientes locais lançam erro de transporte; não confirmam execução remota | Consulta por operação, estados em processamento/concluído/recusado e consistência; distinguir ausência temporária de falha definitiva | Todas |
| C05 | Atualização concorrente | Nenhuma revisão remota comprovada | Versão/ETag ou equivalente conferido atomicamente na gravação; conflito sem alteração parcial | Alteração/cancelamento |
| C06 | Produtos e preço autorizado | Itens históricos têm código e valor; não são catálogo | Consulta de ativos, unidades/conversões, tabela aplicável, desconto e validação no ato da gravação | Criação/alteração |
| C07 | Condições, endereço e frete | Contrato comercial completo ausente | IDs autorizados por cliente, endereço por pedido, transportadora, frete, tributos, arredondamento e total final | Criação/alteração |
| C08 | Empresa e representante | Mapeador de clientes possui atendimentos e código de representante | IDs inequívocos e regra de seleção; resolver ambiguidades sem editar cadastro | Criação |
| C09 | Crédito, inadimplência e estoque | Leitura de saldo não prova política de crédito | Validação no ERP antes do commit, mensagens de recusa, reserva de estoque e política de saldo concorrente | Criação/alteração |
| C10 | Estado elegível | Importação conhece rótulos de situação; não efeitos ou permissões completas | Tabela de ações por estado, vínculos fiscais/logísticos/financeiros, validação atômica com operação | Alteração/cancelamento |
| C11 | Editar pedido e itens | Não há handler Toth remoto identificado | PATCH versus substituição; campos omitidos/null, IDs de linha, remoção, rollback integral, motivo e total canônico | Alteração |
| C12 | Cancelar pedido | Leitura reconhece CANCELADO; não há comando validado | Cancelamento sem exclusão, repetição segura, motivo, efeitos sobre estoque/financeiro e consulta do resultado | Cancelamento |
| C13 | Mudanças diretas no ERP | Sync paginado por janela, padrão 90 dias | Consulta exata/incremental por alteração, revisão/ordenação, cancelados antigos e paginação consistente | Piloto de criação também |
| C14 | Autenticação/transporte | Dois clientes e possibilidade de HTTP; configuração atual não consultada | Ambiente, TLS/canal protegido, escopo mínimo, expiração e garantia de não executar quando autenticação falha | Todas |
| C15 | Homologação isolada | Existência desconhecida pelo CTO | Ambiente sem efeitos em estoque/financeiro/fiscal reais, credenciais e dados próprios | Validação de escrita |
| C16 | Operação e limites | Paginação implementada; limites atuais não confirmados | Rate limit, timeout, manutenção, retry-after, responsável por incidentes e frequência aceitável | Dimensionamento/piloto |

## Contrato de campos a devolver

Para cada campo, o fornecedor deve informar: nome exato, tipo, obrigatório/condicional, limite, formato, valores válidos, origem, efeito de omissão/null e possibilidade de alteração. Não propomos nomes de payload antes do contrato.

| Grupo | Conteúdo mínimo |
|---|---|
| Operação | ID de correlação, chave de idempotência, motivo, versão esperada, identificação do integrador |
| Pedido | ID estável, empresa/filial, cliente, representante, estado, revisão e timestamps com fuso |
| Comercial | Condição de pagamento, moeda, tabela de preço, descontos autorizados, tributos e arredondamento |
| Entrega | Endereço válido, modalidade/valor do frete, transportadora quando exigida |
| Itens | ID da linha, produto, unidade, quantidade, preço validado, descontos, tributos e total |
| Resultado | Sucesso confirmado, rejeição, processamento pendente, código de erro, ID e versão finais, totais canônicos |

## Casos que o contrato precisa permitir homologar

1. Dois envios simultâneos da mesma operação produzem um único pedido.
2. Mesma chave com payload diferente é recusada, não reaproveitada silenciosamente.
3. ERP grava e a resposta se perde; consulta recupera o pedido sem nova criação.
4. Pedido muda na tela do ERP entre leitura e envio; a versão antiga é recusada sem sobrescrita.
5. Estado muda para impeditivo durante o envio; operação inteira é recusada.
6. Um item é inválido; não resta pedido parcialmente gravado nem efeito operacional parcial sem representação explícita.
7. Alteração/cancelamento repetidos não repetem efeitos financeiros ou de estoque.
8. Mudança tardia de pedido antigo é recuperável fora da janela normal.
9. Credencial expirada ou sem permissão não executa a operação; especificar status e corpo.
10. Inclusão com cliente/produto existente preserva os respectivos cadastros.

Registrar em cada evidência: versão do contrato, ambiente, data, responsável, entrada fictícia, resultado esperado/observado e IDs sem segredos. Não executar esses casos em produção nesta etapa.
