# Ajustar pedido ganho

Na ficha do negócio ganho, em **Produtos e Valores**, a ação **Ajustar pedido ganho** permite corrigir quantidade, preço e desconto dos itens existentes. Sem itens, permite informar o novo valor total. O motivo é obrigatório; o formulário mostra o valor anterior e o novo total antes de salvar. O histórico dos últimos 20 ajustes aparece abaixo.

O pedido, a aprovação, os responsáveis, o desfecho e a data original são preservados. A operação mantém o ID do pedido espelhado na Carteira. Pedidos com vínculo identificado com ERP devem ser atualizados na origem; a ação não envia alterações ao Toth, Tiny ou Omie. Vendas sem vínculo único no caderno são recusadas para conferência, sem inferir qual pedido pertence ao cliente.

## Diagnóstico

Investigação somente de leitura na organização Café Jurerê em 14/09/2026: a edição de itens já existia; faltava uma ação para ajustar o total de um negócio já ganho sem reabri-lo. `definir_desfecho_da_entrada` retorna sem mudar nada quando o desfecho já é ganho. `fn_deal_outcome_para_caderno` só produz eventos na troca de desfecho, e a edição de pedido da Carteira declara que não corrige `sale_events`. Portanto, adicionar apenas um campo de valor deixaria o caderno divergente.

Não foi identificado um cliente específico: o solicitante confirmou que precisava de uma opção geral. Nenhum pedido real foi alterado.

## Gravação e auditoria

- `ajustar_pedido_ganho` valida autenticação, organização e acesso ao lead; bloqueia o negócio e verifica a revisão `updated_at` recebida pela ficha. A revisão é preservada como string, sem truncar os microssegundos.
- Itens e total são gravados na mesma transação. O banco calcula o total pelos itens; nenhum produto é inserido ou removido por este fluxo.
- Se o total muda, são acrescentados um estorno e uma substituição à venda original. O caderno continua imutável. `adjusts_sale_id` permite que o trigger preserve a data original, obtida no banco.
- O par é inserido em uma única instrução, para que os triggers de primeira venda vejam a venda válida substituta. A admissão da Carteira ignora o par de ajuste, e a RPC atualiza o pedido já existente no lugar.
- `deal_order_adjustments` guarda motivo, autor, valores e itens antes/depois. Acesso autenticado permite apenas leitura com RLS. Cada valor corrigido mantém a atribuição e a moeda da venda original.
- Não altera os itens de pedidos independentes do ERP ou importa produtos novos para o negócio. Cadastros antigos sem associação única entre negócio e venda precisam de reconciliação específica.

## Validação

`npm run test:won-order` executa PostgreSQL isolado via PGlite, sem credenciais: identidade do pedido, data, receita líquida, totais de Carteira, correções sucessivas, itens, rollback, revisão desatualizada, acesso entre organizações e histórico.

Os testes Vitest cobrem o formulário, o contrato da RPC, invalidações, erro de gravação e ausência de sobreposição de modais. Build de produção e ratchet de TypeScript foram executados. A conferência visual de desktop e celular usa dados fictícios em uma prévia local.

O verificador geral `guard:master-ghost` falha por ocorrências preexistentes. A saída foi comparada com a migration nova presente e ausente: idêntica. Nenhum baseline foi alterado para acomodar este trabalho.

## Publicação

A migration foi criada com a CLI e ordenada após a cadeia legada que usa datas futuras. Aplicar somente `20271021000006_ajustar_pedido_ganho.sql`, com autorização de produção; não executar a cadeia inteira indiscriminadamente. Antes de aplicar, conferir a definição de `fn_sale_events_force_sold_at` e de `trg_carteira_admite_venda` no alvo. A migration considera ambientes antigos sem o trigger de admissão.

Publicar o banco antes do frontend. Até a migration estar disponível, a interface informa que o ajuste não está disponível no ambiente. Não há backfill nem alteração de pedidos existentes no deploy. Rollback da interface pode retirar a ação; manter os eventos e a auditoria já registrados, sem apagar ajustes efetuados.
