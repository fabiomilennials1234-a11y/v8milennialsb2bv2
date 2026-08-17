/**
 * Carteira — rótulos de exibição de pedido.
 *
 * `sourceLabel`/`sourceBadgeClass` vieram de `ClienteOrderHistory.tsx:22-50`,
 * que agora importa daqui. Duas cópias divergiriam na primeira vez que alguém
 * acrescentasse uma origem.
 */

// ─── Origem do registro (upsell_orders.source) ──────────────────────────────

export function sourceLabel(source: string | null): string {
  switch (source) {
    case "pipe":
      return "Pipeline";
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

export function sourceBadgeClass(source: string | null): string {
  switch (source) {
    case "pipe":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "copilot":
      return "bg-primary/10 text-primary border-primary/20";
    case "erp":
      return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
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
