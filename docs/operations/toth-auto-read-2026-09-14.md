# Café Jurerê — validação da leitura automática (14/09/2026)

## Estado de produção

- Org: `4922638c-4909-494e-ba10-12282ec0b161`.
- `toth-sync-pedidos` versão 8 publicada. Nenhum cron de pedidos ativado.
- Flow ainda sem configuração persistida: validação de login falha em transporte.
- Chamada pg_net 2778568, região sa-east-1: HTTP 502, step=login,
  reason=transport, upstream_status=null. Não houve resposta HTTP do ERP.
- Acesso local: TCP conectou em 0,38 s ao endereço público, mas não recebeu
  bytes em 15 s. POST de autenticação também falhou no transporte.
- Endereço a verificar com o fornecedor: `http://cafejurere.ddns.net:3000/flow/crm/auth`.
- Sem escrita no ERP. Nenhuma branch efêmera criada.

## Auditoria das métricas

Dados importados em 11/09: 23.232 pedidos novos e quatro vínculos com vendas
existentes, preservando origem, identidade e valores destas vendas.

Em 14/09, os 5.105 clientes com vendas aprovadas tiveram zero divergências
na contagem, valor acumulado, última compra e ciclo médio da Carteira, comparados
com agregação independente de upsell_orders. O ciclo da Carteira usa dias
distintos de compra; a cadência específica do ERP usa intervalos entre pedidos.

Recalculada a cadência ERP dos 12.728 cadastros. Quatro cadastros novos tinham
contagem ainda nula; após recálculo, zero divergências. Primeira compra e média
de intervalos já estavam corretas.

Faturados aprovados: 17.117. Cancelados rejeitados: 1.229. Devolvidos rejeitados:
133. Normais pendentes: 4.704. Parciais pendentes: 49. Estes últimos não entram
como receita até existir evidência do valor faturado.

Duas datas cadastrais do ERP são posteriores ao último pedido faturado importado:
TORREFATTO (11/09/2026 versus 11/02/2025) e FAZENDA TRES MENINAS
(22/07/2025 versus 25/02/2025). Preservadas até reconciliação com ERP disponível.

## Faturamento parcial — dependência do fornecedor

Inspeção de todas as 57 fatias dos pedidos parciais na extração de 11/09:
cabeçalho contém numeropedido, dataemissao, numeroinscricao, valortotalliquido,
statuspedido e itens; item contém codigoproduto, descricaoproduto, qtdpedido,
valorunitario. Nenhum valor/quantidade faturado ou vínculo a nota fiscal.
A coleção Postman fornecida só documenta login, clientes e cobranças.
Não foi possível verificar uma resposta mais recente devido à indisponibilidade.

Solicitar ao fornecedor: valor líquido efetivamente faturado por pedido e item,
quantidade faturada, datas de faturamento, identificadores estáveis de pedido,
item e nota, valores devolvidos/cancelados e regra de descontos/frete/impostos.
Pedir exemplo de pedido parcialmente faturado em mais de uma nota, incluindo
devolução. Não inferir a proporção a partir de quantidade pedida.

## Retomada

1. Restabelecer resposta externa do serviço Flow; validar login na nuvem.
2. Configurar via action=configure_flow, com autorização admin ou cron; credenciais
   cifradas no cofre existente. Não incluir segredos em SQL versionado ou logs.
3. Dry-run e execução real curta; verificar quatro aliases e ausência de duplicação.
4. Agendar pg_cron por organização com x-cron-secret, região sa-east-1 e janela
   móvel de 90 dias. Confirmar uma volta completa e retomada por cursor antes
   de declarar ativo. Leituras futuras não abrangem mudanças anteriores à janela.
5. Integrar faturamento parcial apenas após receber e validar contrato real.

O caminho de configuração não inicia sincronização. Falha do Flow não desconecta
o serviço de clientes, que tem credenciais próprias. Aliases explícitos toth:N
enriquecem apenas status ERP e itens, sem substituir a venda original.
