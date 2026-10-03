/**
 * Carteira — conversão de data do pedido entre ISO e `<input type="date">`.
 *
 * Pura e isolada de propósito: é a lógica onde um erro move uma venda de dia
 * (e de mês, no dia 1º) sem ninguém perceber.
 */

/**
 * ISO → `YYYY-MM-DD` para o `<input type="date">`, pelas partes **locais**.
 *
 * Usar as partes UTC faria a data pular sozinha só de abrir o formulário: em
 * BRT (UTC−3), um pedido das 21h já é o dia seguinte em UTC.
 */
export function toDateInput(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Troca só a DATA, preservando a hora original do pedido.
 *
 * NÃO normaliza para meio-dia. A convenção de meio-dia vem de
 * `useNewOrder.ts:29-31`, mas lá o pedido está NASCENDO e não existe hora
 * anterior a preservar. Aqui a linha já existe — pode ter vindo do ERP, de
 * import, ou de uma venda registrada com hora real.
 *
 * Reescrever para 12:00 local move o instante UTC: medido em prod, **29 dos
 * 302** pedidos manuais aprovados têm `sold_at` entre 00:00 e 03:00 UTC, e para
 * esses o dia UTC anda para trás. Com a fronteira UTC×BRT já conhecida no
 * dashboard, isso vira número errado em relatório.
 */
export function withDatePreservingTime(
  originalIso: string,
  dateInput: string,
): string {
  const [year, month, day] = dateInput.split("-").map(Number);
  const next = new Date(originalIso);
  next.setFullYear(year, month - 1, day);
  return next.toISOString();
}
