export const subscriptionLabels: Record<string, string> = {
  active: "Ativa",
  trial: "Em avaliação",
  overdue: "Em atraso",
  suspended: "Suspensa",
  cancelled: "Cancelada",
  expired: "Expirada",
};
export const paymentLabels: Record<string, string> = {
  PENDING: "Aguardando pagamento",
  RECEIVED: "Pago",
  CONFIRMED: "Confirmado",
  OVERDUE: "Em atraso",
  REFUNDED: "Estornado",
  CANCELLED: "Cancelado",
  REFUND_REQUESTED: "Estorno solicitado",
  CHARGEBACK_REQUESTED: "Em contestação",
  PAID: "Pago",
  FAILED: "Falhou",
};
export function cycleLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    monthly: "Mensal",
    semiannual: "Semestral",
    semester: "Semestral",
    annual: "Anual",
  };
  return labels[value ?? ""] ?? "Não informado";
}
export function methodLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    PIX: "Pix",
    CREDIT_CARD: "Cartão de crédito",
    CARD: "Cartão de crédito",
    BOLETO: "Boleto",
  };
  return labels[value?.toUpperCase() ?? ""] ?? "Não informado";
}
export function money(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "Não informado";
}
export function billingDate(value: string | null | undefined) {
  if (!value) return "Não informada";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime())
    ? "Não informada"
    : date.toLocaleDateString("pt-BR");
}
/** Só documentos HTTPS. Nunca executar esquemas vindos do banco. */
export function documentUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
