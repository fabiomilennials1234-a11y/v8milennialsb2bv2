# Ticket 18 — relações de produto

## Relações expostas

| Relação no editor | Fonte canônica | Identidade | Semântica |
| --- | --- | --- | --- |
| Item do negócio do gatilho | `pipeline_entries.deal_id` → `deal_items.product_id` | negócio exato + produto | O produto cadastrado compõe o negócio que disparou a execução. |
| Associação manual ativa do lead | `lead_products` com `source = 'manual'` e `status = 'active'` | lead + produto | O produto está associado manualmente ao lead neste momento. |
| Registro de negócio ganho | `lead_products` com `source = 'deal'`, `purchase_count > 0` e `last_purchased_at` preenchido | lead + produto | O CRM registrou o produto quando um negócio foi marcado como ganho. |

Cada regra persiste o UUID do produto. Nome é somente rótulo. Item avulso com
`deal_items.product_id IS NULL` não é comparado por texto. Produto de outro negócio,
outra organização ou outra relação não satisfaz a regra.

Produto ativo e acessível sem relação retorna `false`. UUID removido, inativo ou de
outra organização retorna `reference_unavailable`. Isso impede que exclusão pareça
ausência comercial e impede que outro cadastro com o mesmo nome assuma a identidade.

## Autorização

- Teste pessoal exige `products.view` e visibilidade atual do lead.
- Item do negócio do gatilho também exige `pipeline.view` e o
  `pipeline_entry_id` exato.
- Execução automática exige grant separado para cada relação:
  `product.trigger_business_item`, `product.lead_association` ou
  `product.won_deal_history`.
- Histórico revalida `products.view`; o item do negócio também revalida
  `pipeline.view`.

## Critérios deliberadamente fora do catálogo

- Produto com pagamento confirmado. Negócio ganho não prova liquidação.
- Pedido ou nota fiscal em ERP externo.
- Variante/SKU específico dentro de um produto.
- Item avulso inferido por semelhança de nome.
- Reconstrução histórica de produto após reabrir, alterar ou ganhar novamente um
  negócio além do agregado canônico existente.

Antes de expor qualquer item acima, CTO precisa decidir fonte canônica, evento que
cria e revoga a relação, identidade persistida, regra de idempotência, tratamento de
estorno/reabertura e se a consulta representa estado atual ou histórico imutável.
