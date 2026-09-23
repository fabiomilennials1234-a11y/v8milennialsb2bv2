import { DERIVED_FIELDS, QUOTE_INSTRUCTION } from "./quote-document.ts";
export function buildQuoteTool(fields: string[], required: string[]) {
  const money = { type: "integer", minimum: 0, description: "Valor autorizado em centavos, inclusive zero explícito; não inventar preços/tributos." };
  return {
    name: "generate_order_request",
    description: `${QUOTE_INSTRUCTION} Primeiro use status para ler o rascunho e dados do lead. save altera apenas dados novos; mudanças comerciais exigem nova confirmação. prepare valida e retorna o resumo exato a apresentar. generate usa a confirmação real do cliente; send enfileira o arquivo. O orçamento atual é resolvido internamente pela conversa. Campos obrigatórios: ${required.join(", ")}.`,
    input_schema: { type: "object", additionalProperties: false, properties: {
      operation: { type: "string", enum: ["status", "save", "prepare", "generate", "send"] },
      data: { type: "object", additionalProperties: false, properties: {
        values: { type: "object", additionalProperties: false, properties: Object.fromEntries(fields.filter(f => !DERIVED_FIELDS.includes(f)).map(f => [f, { type: "string" }])) },
        items: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, properties: {
          code: { type: "string" }, description: { type: "string" }, unit: { type: "string" }, quantity: { type: "string", description: "Quantidade decimal positiva. Ex: 2 ou 1.500" }, unit_price_cents: money,
        }, required: ["code", "description", "unit", "quantity", "unit_price_cents"] } },
        freight_cents: money, discount_cents: money, tax_cents: money, extra_cents: money,
      } },
    }, required: ["operation"] },
  };
}
