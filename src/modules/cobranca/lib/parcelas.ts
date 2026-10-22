/**
 * Parcelas de um acordo. O Torque não negocia (decisão do CTO, 21/10): isto só
 * ajuda a pessoa a DIGITAR o que combinou — total dividido em N meses, que ela
 * ainda pode editar uma a uma antes de registrar.
 */
import { isoDia } from "./atraso";

/** Soma meses à data `aaaa-mm-dd`, segurando o fim do mês (31/01 + 1 → 28/02). */
export function maisMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(a, m - 1 + meses, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimo));
  return isoDia(alvo);
}

/** Divide o total em N parcelas mensais em centavos; o resto da divisão vai na última. */
export function gerarParcelas(total: number, n: number, primeira: string): { vencimento: string; valor: number }[] {
  if (!total || total <= 0 || n < 1 || !primeira) return [];
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / n);
  return Array.from({ length: n }, (_, i) => ({
    vencimento: maisMeses(primeira, i),
    valor: (i === n - 1 ? centavos - base * (n - 1) : base) / 100,
  }));
}
