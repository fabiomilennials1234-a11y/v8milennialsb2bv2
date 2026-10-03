/** Selo de origem do pedido (fila de aprovação e cartão de aprovação). */
// V5: hex de tema escuro fixo → tons de token (funcionam nos dois temas).
export const SOURCE_STYLES: Record<string, { className: string; label: string }> = {
  copilot: { className: "bg-insights/10 text-insights", label: "Copilot" },
  manual: { className: "bg-primary-soft text-primary-soft-foreground", label: "Manual" },
  pipe: { className: "bg-success/10 text-success", label: "Funil" },
  erp: { className: "bg-foreground/[.07] text-foreground/80", label: "ERP" },
  csv_import: { className: "bg-muted text-muted-foreground", label: "CSV" },
};
