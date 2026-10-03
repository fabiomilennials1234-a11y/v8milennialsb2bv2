/**
 * Carteira — rótulos de exibição de pedido.
 *
 * `sourceLabel`/`sourceBadgeClass` vieram de `ClienteOrderHistory.tsx:22-50`,
 * que agora importa daqui. Duas cópias divergiriam na primeira vez que alguém
 * acrescentasse uma origem.
 */

// ─── Origem do registro (upsell_orders.source) ──────────────────────────────

export function sourceLabel(source: string | null): string {
  if (source === "historical") return "Venda histórica";
  switch (source) {
    case "pipe":
      return "Funil";
    case "manual":
      return "Manual";
    case "erp":
      return "ERP";
    case "copilot":
      return "Copilot";
    case "csv_import":
      return "CSV";
    default:
      return source ?? "—";
  }
}

/**
 * V5: tons de token (antes azul/roxo cru, que no claro reprovava contraste).
 * A borda fica transparente — a pílula é o fundo tintado.
 */
export function sourceBadgeClass(source: string | null): string {
  switch (source) {
    case "pipe":
      return "border-transparent bg-insights/10 text-insights";
    case "copilot":
      return "border-transparent bg-primary-soft text-primary-soft-foreground";
    case "erp":
      return "border-transparent bg-foreground/[.07] text-foreground/80";
    default:
      return "border-transparent bg-muted text-muted-foreground";
  }
}

// ─── Procedência / vínculo ERP (carteira_erp_source) ────────────────────────

/**
 * Nome do sistema de origem, para o badge.
 *
 * Rotula pela PROCEDÊNCIA, não por "Faturado": medido em prod, `notas_fiscais`
 * tem 0 linhas na base inteira e o vínculo real vem de `tiny_order_id` (232) e
 * `external_source` (95). Chamar esses 232 de "Faturado" seria afirmar uma nota
 * fiscal que não existe.
 */
export function erpSourceLabel(erpSource: string | null): string {
  switch (erpSource) {
    case "nfe":
      return "NF-e";
    case "omie":
      return "Omie";
    case "tiny":
      return "TinyERP";
    default:
      return "ERP";
  }
}

/**
 * Motivo do bloqueio de edição. Nomeia a ORIGEM e indica o caminho — nunca
 * fala de permissão, que é a confusão a evitar (o usuário tem permissão; o
 * registro é que não é dele para editar).
 */
export function erpBlockMessage(erpSource: string | null): string {
  if (erpSource === "nfe") {
    return "Pedido com NF-e emitida — edite no ERP de origem";
  }
  return `Pedido sincronizado do ${erpSourceLabel(erpSource)} — edite no ERP de origem`;
}
