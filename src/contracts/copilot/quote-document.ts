/** Shared contract; money is integer cents and quantity has at most 3 decimals. */
export const QUOTE_BUCKET = "copilot-quotes";
export const QUOTE_MAX_BYTES = 5 * 1024 * 1024;
export const QUOTE_TOOL_ID = "GERAR_ORCAMENTO_PDF";
export const QUOTE_INSTRUCTION = "Colete os dados do orçamento sem inventar preços ou condições. Salve o rascunho, apresente o resumo retornado pela ferramenta e peça a confirmação com o código informado. Gere após a confirmação e solicite o envio do arquivo pronto. Nunca anuncie envio antes do resultado.";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export interface QuoteConfig {
  template_document_id?: string | null;
  required_fields?: string[];
  convert_to_pdf?: boolean;
  template_name?: string;
  fields?: string[];
}
export interface QuoteItem {
  code: string;
  description: string;
  unit: string;
  quantity: string;
  unit_price_cents: number;
}
export interface QuoteData {
  values: Record<string, string>;
  items: QuoteItem[];
  freight_cents: number;
  discount_cents: number;
  tax_cents: number;
  extra_cents: number;
}
export const DERIVED_FIELDS = ["total", "subtotal", "freight", "discount", "tax", "extra"];
export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function cents(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100_000_000_000) throw new Error("Valor monetário inválido.");
}
export function validateQuoteData(input: unknown): QuoteData {
  if (!input || typeof input !== "object") throw new Error("Dados do orçamento ausentes.");
  const d = input as QuoteData;
  if (!d.values || typeof d.values !== "object" || Array.isArray(d.values) || Object.keys(d.values).length > 100) throw new Error("Campos inválidos.");
  for (const [key, value] of Object.entries(d.values)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || ["constructor", "prototype"].includes(key) || typeof value !== "string" || value.length > 2000 || /\{\{|\}\}/.test(value) || [...value].some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))) throw new Error("Campo inválido.");
  }
  if (!Array.isArray(d.items) || !d.items.length || d.items.length > 100) throw new Error("Informe de 1 a 100 produtos.");
  for (const item of d.items) {
    if (!item || typeof item !== "object") throw new Error("Produto inválido.");
    for (const key of ["code", "description", "unit"] as const) {
      if (typeof item[key] !== "string" || !item[key].trim() || item[key].length > 500 || /\{\{|\}\}/.test(item[key])) throw new Error("Produto incompleto.");
    }
    if (typeof item.quantity !== "string" || !/^\d{1,6}(\.\d{1,3})?$/.test(item.quantity) || Number(item.quantity) <= 0) throw new Error("Quantidade inválida.");
    cents(item.unit_price_cents);
  }
  for (const key of ["freight_cents", "discount_cents", "tax_cents", "extra_cents"] as const) cents(d[key]);
  return d;
}
export function itemTotal(item: QuoteItem): number {
  const [whole, fraction = ""] = item.quantity.split(".");
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  const result = (milli * BigInt(item.unit_price_cents) + 500n) / 1000n;
  if (result > 100_000_000_000n) throw new Error("Valor do item excede limite.");
  return Number(result);
}
export function renderQuoteData(input: unknown, fields: string[], required: string[]) {
  const d = validateQuoteData(input);
  if (fields.some(f => !/^[a-z][a-z0-9_]{0,63}$/.test(f))) throw new Error("Modelo inválido.");
  if (required.some(f => !fields.includes(f))) throw new Error("Campo obrigatório não existe no modelo.");
  const missing = required.filter(f => !DERIVED_FIELDS.includes(f) && !d.values[f]?.trim());
  if (missing.length) throw new Error(`Preencha: ${missing.join(", ")}`);
  const subtotal = d.items.reduce((sum, item) => sum + itemTotal(item), 0);
  const total = subtotal + d.freight_cents + d.tax_cents + d.extra_cents - d.discount_cents;
  if (!Number.isSafeInteger(total) || total < 0 || total > 100_000_000_000) throw new Error("Total inválido.");
  const computed = { subtotal: formatMoney(subtotal), total: formatMoney(total), freight: formatMoney(d.freight_cents), discount: formatMoney(d.discount_cents), tax: formatMoney(d.tax_cents), extra: formatMoney(d.extra_cents) };
  const all: Record<string, string> = { ...d.values, ...computed };
  return {
    values: Object.fromEntries(fields.map(f => [f, all[f] ?? ""])),
    items: d.items.map(item => ({ code: item.code, description: item.description, unit: item.unit, quantity: item.quantity.replace(".", ","), unit_price: formatMoney(item.unit_price_cents), total: formatMoney(itemTotal(item)) })),
    total_cents: total,
  };
}
export function quoteConfigFromTool(config: Record<string, unknown>): QuoteConfig {
  return {
    template_document_id: typeof config.templateDocumentId === "string" ? config.templateDocumentId : null,
    template_name: typeof config.templateName === "string" ? config.templateName : "",
    fields: Array.isArray(config.fields) ? config.fields.filter((v): v is string => typeof v === "string") : [],
    required_fields: String(config.requiredFields ?? "").split(",").map(s => s.trim()).filter(Boolean),
    convert_to_pdf: config.convertToPdf === true || config.convertToPdf === "true",
  };
}
