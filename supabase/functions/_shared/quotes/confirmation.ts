import { DERIVED_FIELDS, renderQuoteData } from "../../../../src/contracts/copilot/quote-document.ts";

/** Deliberately accepts only unambiguous replies, never confirmations with edits. */
export function isQuoteConfirmation(message: string): boolean {
  const text = message.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[.!]+$/g, "").trim().replace(/\s+/g, " ");
  return /^(sim|confirmo|confirmado|pode fechar|pode seguir|pode gerar|pode enviar|aprovado|aprovo|de acordo|esta correto|tudo certo|ok|sim,? pode (fechar|seguir|gerar|enviar))$/.test(text);
}

export function quoteSummary(data: unknown, fields: string[], required: string[]): string {
  const rendered = renderQuoteData(data, [...new Set([...fields, ...DERIVED_FIELDS])], required);
  const values = Object.entries(rendered.values).filter(([key, value]) => value.trim() && !["subtotal", "total", "freight", "discount", "tax", "extra"].includes(key));
  return ["Resumo do orçamento:", ...values.map(([key, value]) => `${key}: ${value}`),
    ...rendered.items.map(item => `${item.code} — ${item.description} — ${item.quantity} ${item.unit} × R$ ${item.unit_price} = R$ ${item.total}`),
    `Subtotal: R$ ${rendered.values.subtotal ?? (rendered.total_cents / 100).toFixed(2)}`,
    ...["freight", "discount", "tax", "extra"].map((key, index) => `${["Frete", "Desconto", "Impostos", "Acréscimos"][index]}: R$ ${rendered.values[key] ?? "0,00"}`),
    `Total: R$ ${(rendered.total_cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    "Confirma este orçamento? Pode responder sim, confirmo ou pode fechar."].join("\n");
}

/** Only harmless formatting/plural changes are ignored; variants and amounts remain significant. */
export function sameQuoteData(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") {
      const text = value.trim().replace(/\s+/g, " ").toLowerCase();
      return key === "description" ? text.replace(/\b(palheta|preta|branca|ventilada|cega)s\b/g, "$1") : text;
    }
    if (Array.isArray(value)) return value.map(item => canonical(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== "" && item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([field, item]) => [field, canonical(item, field)]));
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
