/**
 * Carteira — schema Zod do formulário de edição de pedido.
 *
 * Espelha, campo a campo, os CHECKs de `upsell_orders` (baseline:26536-26540):
 *   · sale_value > 0                       → upsell_orders_sale_value_check
 *   · product_type ∈ mrr|projeto|unitario  → upsell_orders_product_type_check
 *
 * Sem este espelho o usuário receberia o 400 cru do Postgres
 * ("new row for relation ... violates check constraint") em vez de um erro de
 * campo. O banco continua sendo a autoridade — isto é UX, não segurança.
 */

import { z } from "zod";

/**
 * `product_type` NÃO é editável nesta fatia (os 6 campos editáveis são
 * sale_value, sold_at, product_name, closer_id, sale_responsible_id,
 * client_id). O enum vive aqui porque a UI exibe o valor e porque o dia em que
 * ele virar editável, a regra já está no lugar certo.
 */
export const PRODUCT_TYPES = ["mrr", "projeto", "unitario"] as const;
export const productTypeSchema = z.enum(PRODUCT_TYPES);
export type ProductTypeValue = z.infer<typeof productTypeSchema>;

export const PRODUCT_TYPE_LABELS: Record<ProductTypeValue, string> = {
  mrr: "Recorrente",
  projeto: "Projeto",
  unitario: "Unitário",
};

export const orderItemSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  product_name: z.string().trim().min(1, "Descreva o item"),
  quantity: z.coerce
    .number({ invalid_type_error: "Quantidade inválida" })
    .positive("Quantidade precisa ser maior que zero"),
  unit_price: z.coerce
    .number({ invalid_type_error: "Preço inválido" })
    .min(0, "Preço não pode ser negativo"),
  unit: z.string().trim().min(1).max(16).default("un"),
});

export type OrderItemForm = z.input<typeof orderItemSchema>;

export const editOrderSchema = z
  .object({
    client_id: z.string().uuid("Selecione um cliente"),
    product_name: z.string().trim().min(1, "Informe a descrição do pedido"),
    // `sold_at` chega do <input type="date"> como YYYY-MM-DD.
    sold_at: z.string().min(1, "Informe a data da venda"),
    sale_value: z.coerce
      .number({ invalid_type_error: "Valor inválido" })
      .positive("O valor da venda precisa ser maior que zero"),
    closer_id: z.string().uuid().nullable(),
    sale_responsible_id: z.string().uuid().nullable(),
    items: z.array(orderItemSchema),
  })
  .superRefine((value, ctx) => {
    // Pedido com itens: o total é a soma, e o campo de valor é read-only na UI.
    // Um pedido em modo `manual_total` (venda avulsa, sem itens — ver
    // useNewOrder.ts:34) mantém sale_value editável à mão.
    if (value.items.length === 0) return;

    const sum = value.items.reduce(
      (acc, item) => acc + Number(item.quantity) * Number(item.unit_price),
      0,
    );
    if (sum <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "A soma dos itens precisa ser maior que zero",
      });
    }
  });

export type EditOrderForm = z.input<typeof editOrderSchema>;
export type EditOrderValues = z.output<typeof editOrderSchema>;

/** Soma dos itens — a mesma conta que `carteira_update_order` faz no banco. */
export function sumItems(
  items: { quantity: number | string; unit_price: number | string }[],
): number {
  return items.reduce(
    (acc, item) => acc + Number(item.quantity || 0) * Number(item.unit_price || 0),
    0,
  );
}
