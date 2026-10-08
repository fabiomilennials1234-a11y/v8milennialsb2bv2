# Corrigir data e valor de venda ganha

A ação **Corrigir data e valor da venda** fica em Produtos e Valores no painel
do negócio, nas interfaces nova e clássica. Vendas históricas também podem ser
abertas pelo botão **Abrir venda** na ficha do lead.

A RPC `corrigir_venda_ganha` atende negócios ganhos do funil e encaminha vendas
históricas à RPC já existente. Registra motivo, autor, data e valor anteriores
e corrigidos. Negócio, caderno de receita e pedido espelhado são atualizados na
mesma transação. O estorno permanece no período original e a substituição entra
no dia civil informado, no fuso da organização. O ID e a aprovação do pedido
permanecem iguais; corrigir somente o valor conserva a hora original da venda.

A versão enviada é a que estava no formulário ao abri-lo, protegendo contra
fichas desatualizadas mesmo após refetch em segundo plano. Valores devem ser
positivos com até dois decimais; datas futuras e motivos vazios são recusados.
Somente admin/member ativos com acesso ao lead, ou master, podem corrigir.

Vendas vinculadas a ERP permanecem sob controle do sistema de origem. Quando
há produtos, o total continua derivado dos itens: use **Ajustar pedido ganho**
para preços/quantidades e a nova ação para a data. Vínculos ambíguos são recusados.

A clássica conserva seu snapshot e recebe a funcionalidade por
`scripts/ui-classic/classic.patch`. `snapshot.mjs --gerar-patch` agora funciona
também no Windows. A migração foi gerada pela CLI e renumerada para ordenar
depois da cadeia já aplicada em produção.

Validação: testes PostgreSQL isolados de correção e ajuste de pedidos,
formulários e cards nas duas interfaces, lint dos arquivos alterados,
TypeScript ratchet e build dual. Nenhuma venda real é alterada para testar.
