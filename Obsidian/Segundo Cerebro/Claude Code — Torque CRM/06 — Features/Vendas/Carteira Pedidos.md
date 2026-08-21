---
type: feature
title: Carteira — aba Pedidos (listar e editar)
status: active
created: 2026-08-13
updated: 2026-08-13
tags: [carteira, pedidos, receita, erp, auditoria]
related: ["[[Upsell]]"]
owner: gabriel
---

# Carteira — aba Pedidos (listar e editar)

## O que é

Quarta aba da Carteira (ao lado de Clientes / Analytics / Aprovações). Existe porque pedido aprovado era **imutável pela UI**: cliente em produção relatou *"preciso editar alguns clientes que foram faturados errado, não tem como editar ou excluir o pedido?"*.

**Escopo travado pelo CTO**: *"no escopo desse pedido quero apenas listar os pedidos e poder editar aqueles sem link com o ERP"*.

- ✔ listar pedidos aprovados, com busca e paginação
- ✔ editar pedido **manual** — 6 campos + itens
- ✘ cancelar / descancelar — **fora** desta fatia
- ✘ excluir (hard delete) — fatia 2
- ✘ `upsell_client_products` — fatia 3

## Como funciona

A leitura é pela RPC `carteira_list_orders`, não por `supabase.from("upsell_orders")`: a procedência do pedido depende de 4 caminhos e resolvê-los no cliente daria N+1 por página.

### O gate é procedência, não nota fiscal

Se o pedido nasceu no ERP (ou foi espelhado para lá), o **ERP é a fonte da verdade** e o CRM não edita. Editar de um lado só produziria duas verdades sobre o mesmo pedido, e a divergência só apareceria na conciliação, semanas depois.

`carteira_erp_source(order_id, org_id, tiny_order_id, external_source)` devolve `nfe | tiny | omie | NULL`. **NULL = manual = editável.** É a fonte única dos 4 caminhos — consumida pela lista e pela RPC de edição, para que a UI nunca ofereça um botão que o banco vai recusar.

### Arquivos chave
- `supabase/migrations/20270813120000_carteira_order_edit.sql` — auditoria, índices, `carteira_erp_source`, 2 RPCs
- `src/modules/carteira/components/orders/` — `CarteiraOrders`, `OrdersTable`, `EditOrderDialog`
- `src/modules/carteira/hooks/` — `useCarteiraOrders`, `useUpdateOrder`
- `src/modules/carteira/lib/order-display.ts` — rótulos (compartilhado com `ClienteOrderHistory`)
- `src/modules/carteira/lib/order-errors.ts` — códigos da RPC → português
- `src/modules/carteira/lib/order-schema.ts` — Zod espelhando os CHECKs
- `src/modules/carteira/pages/Upsell.tsx` — 4º item do control

### RPCs
| RPC | Quem pode | Nota |
|---|---|---|
| `carteira_list_orders(p_limit,p_offset,p_search,p_org_id)` | membro da org | STABLE. Só pedidos `approved`. Devolve `is_erp_linked`/`erp_source` resolvidos, itens agregados e `total_count`. `p_org_id` é aditivo, para o master ghost. |
| `carteira_update_order(p_order_id,p_patch,p_items)` | admin **e** membro | Recusa vínculo ERP (`order_erp_linked`). Cabeçalho + itens no MESMO commit, com `FOR UPDATE` + `ROW_COUNT`. |

## Regras de negócio

- **Pedido com vínculo ERP é read-only.** Vínculo = NF em `notas_fiscais`, `tiny_order_id` preenchido, mapping em `tinyerp_order_mappings`, ou `external_source ∈ ('tiny','omie')`.
- Campos editáveis (6 colunas + itens): `sale_value`, `sold_at`, `product_name`, `closer_id`, `sale_responsible_id`, `client_id`, e `client_purchase_items`. `notes` é **somente leitura** (fora da whitelist).
- **Itens mandam no total**: se a edição manda itens, `sale_value` passa a ser a soma e `product_name` espelha os itens (salvo patch explícito de `product_name`). Pedido `manual_total` (venda avulsa, sem itens) mantém `sale_value` editável à mão.
- Toda edição gera `order_events` com `event_type='edited'` e `payload.before/after`.

## Áreas frágeis

🔴 **Editar pedido aprovado NÃO corrige o livro-razão** (dívida aceita pelo CTO). A edição altera `upsell_orders` e as métricas derivadas de `upsell_clients`, mas **não** emite correção em `sale_events`: os gatilhos de `20260723013018` só escutam `AFTER INSERT WHEN approved` e `AFTER UPDATE OF approval_status`, nenhum observa `sale_value`/`sold_at`/`client_id`/`sale_responsible_id`. A venda fica congelada no caderno com os valores da aprovação. Só org com `carteira_emits_revenue_enabled = true` vê a divergência — hoje **apenas Milennials** (41 pedidos aprovados, 41 editáveis, 41 com linha no caderno: interseção 100%, nenhum cliente pagante exposto). **Nenhuma UI pode afirmar que a edição mexe em receita** — por isso o toast de troca de cliente fala em "métricas de carteira", não em receita. Saída futura: par corretivo (`sale_reversed` + `sale`) atrás da mesma flag, respeitando a chave de idempotência da #1199.

🟠 **Rotular por "Faturado" seria mentira.** `notas_fiscais` tem **0 linhas na base inteira**; o vínculo real vem de `tiny_order_id` (232 pedidos) e `external_source` (95). Por isso o badge e o tooltip nomeiam o **sistema** (TinyERP / Omie / NF-e) e nunca mandam "cancelar a nota" — mandaria o usuário caçar um documento que não existe.

🟠 **Anti-spam do audit.** `trg_order_event_audit` passou a ouvir TODO update (era `UPDATE OF approval_status`). Três caminhos de ERP re-sincronizam pedidos a cada ciclo; sem o guard `IS DISTINCT FROM` sobre o snapshot dos 6 campos, cada ciclo geraria um `edited` por pedido. Re-sync idêntico não grava nada. **Abrir campo novo à edição exige estender o snapshot na mesma mudança.**

🟠 **O gate de ERP vive na RPC, não em RLS.** Esta fatia não toca policy nenhuma. Um `PATCH` cru via PostgREST ainda alcança `upsell_orders` — superfície pré-existente, não introduzida aqui, mas registrada para quem for endurecer.

## Edge cases

- **Corrida no cabeçalho**: os itens são apagados e reinseridos ANTES do UPDATE do cabeçalho. `FOR UPDATE` no `SELECT` inicial + `GET DIAGNOSTICS ROW_COUNT` depois do UPDATE garantem que uma escrita concorrente não deixe `sale_value` velho com itens novos e ainda retorne sucesso (`order_state_changed`).
- **Mover `client_id`**: `trg_upsell_order_recalc_metrics` recalcula os **dois** clientes. O dialog mostra o delta previsto dos dois antes de confirmar, e avisa quando o cliente de origem fica sem nenhum pedido.
- **Cliente inativo**: `ClientChipSelector` filtrava `is_active`, o que fazia o seletor não achar o próprio cliente do pedido. Agora inclui o já selecionado.
- **Paginação**: 50 por página. Sem ela, a org com 296 pedidos mostrava 50 e escondia 246.

## Histórico

- 2026-08-13 — FATIA 1: aba Pedidos, listar + editar pedido manual. Escopo cortado pelo CTO (cancelar saiu do diff inteiro).
