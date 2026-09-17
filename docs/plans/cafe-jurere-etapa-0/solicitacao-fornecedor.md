# Solicitação ao fornecedor — escrita de pedidos da Café Jurerê

**Rascunho pronto para encaminhamento pelo responsável. Não enviado pelo agente.**

Olá, equipe Toth e TI Café Jurerê.

Estamos especificando a evolução da integração Torque CRM para criar pedidos definitivos e, em etapas posteriores, alterar e cancelar exclusivamente os pedidos criados por essa nova integração. Cadastros existentes e pedidos anteriores permanecerão preservados. Clientes, produtos, preços e condições devem obedecer às regras do ERP.

Antes do desenvolvimento da escrita, precisamos das confirmações abaixo. Para cada item, pedimos indicar: disponível hoje, depende de desenvolvimento ou não suportado; responsável; documentação/exemplo; e previsão, quando houver.

1. **Serviço e contrato:** qual API atenderá criação, alteração, cancelamento e consulta? Será no Toth ou no gateway Flow? Enviar versão do contrato, métodos, rotas, schemas completos, erros e exemplos com dados fictícios. POST de consulta de pedidos não será tratado como inclusão.
2. **Homologação:** existe ambiente separado da produção, com dados e credenciais próprios e sem efeitos reais sobre estoque, financeiro ou documentos fiscais? Qual o processo de acesso? Credenciais devem ser compartilhadas por canal seguro, nunca anexadas a esta resposta.
3. **Inclusão definitiva:** quais efeitos são disparados — reserva/baixa de estoque, cobrança, faturamento, expedição? A inclusão pode atualizar implicitamente cliente, produto, endereço ou outro cadastro? Precisamos impedir esses efeitos cadastrais.
4. **Identificação e duplicidade:** existe chave de idempotência ou referência externa única, validada atomicamente? Qual sua abrangência, retenção e comportamento para chamadas simultâneas ou mesma chave com conteúdo diferente? O número do pedido é único entre empresas/filiais?
5. **Resposta perdida:** como consultar uma operação quando o ERP pode ter gravado, mas não recebemos resposta? A consulta permite distinguir processamento pendente, conclusão e recusa? Quando a ausência do registro é conclusiva?
6. **Concorrência:** há revisão/ETag ou mecanismo equivalente que recuse atomicamente uma atualização/cancelamento se o pedido mudou desde nossa leitura? Uma consulta anterior à escrita, sem essa garantia, não basta.
7. **Dados comerciais:** como consultar catálogo ativo, unidades, preços por cliente, descontos autorizados, condições de pagamento, empresa/filial, representante, endereços e frete? Informar campos obrigatórios, IDs, tributos, moeda, arredondamento e retorno do total final.
8. **Bloqueios:** o ERP valida crédito, inadimplência, estoque e elegibilidade comercial no momento da gravação? Quais erros retorna? O CRM não permitirá ignorar esses bloqueios.
9. **Alteração:** quais campos são editáveis e em quais situações? Precisamos incluir/remover itens, mudar quantidades e escolher condições válidas, mantendo cliente, empresa e representante fixos. Qual a diferença entre campo omitido, vazio e null? Qual o ID estável de cada item? A operação é integralmente transacional?
10. **Cancelamento:** quais estados e vínculos impedem cancelar? Como informar motivo? Quais efeitos são revertidos? A repetição é segura? Precisamos manter o histórico, sem exclusão física do pedido.
11. **Mudanças no próprio ERP:** como detectar alterações e cancelamentos, inclusive de pedidos antigos? Há consulta por ID, filtro por data de alteração, revisão monotônica ou eventos? Como garantir paginação consistente e pedidos completos?
12. **Acesso e operação:** confirmar canal protegido para escrita, autenticação, permissões mínimas, expiração, limites de chamadas, timeouts, manutenção e contato para incidentes. Se houver gateway, esclarecer quais garantias ele fornece e quais dependem do ERP.

Solicitamos também a tabela de estados do pedido com as ações permitidas e os vínculos de estoque, financeiro, fiscal e expedição que bloqueiam alterações/cancelamentos. Precisamos confirmar o significado operacional dos estados; aceitar uma chamada tecnicamente não é suficiente.

Após essas respostas, prepararemos os casos de homologação com criação única, resposta perdida, edição concorrente, bloqueios comerciais, alteração e cancelamento. A escrita em produção será liberada separadamente, após validação e autorização da Café Jurerê.

| Item | Disponível / desenvolver / não suportado | Evidência ou documento | Responsável | Previsão |
|---|---|---|---|---|
| 1–12 (uma linha por item na resposta) | A preencher | A preencher | A preencher | A preencher |
