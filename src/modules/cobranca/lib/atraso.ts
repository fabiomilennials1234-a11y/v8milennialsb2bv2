/**
 * Atraso de um título ou de um caso.
 *
 * A data manda: dias inteiros entre o vencimento e HOJE no fuso do navegador
 * (mesma régua de `carteira/lib/inadimplencia.ts`). Duas escalas, cada uma com
 * um trabalho, e de propósito diferentes:
 *
 *  - TOM (cor do selo, board de 21/10): até 15 dias atenção, até 30 aviso,
 *    até 60 alerta, acima disso crítico. O cobrador lê a urgência de um caso.
 *  - FAIXA (carteira, 30/60/90): a régua clássica de aging que a RPC
 *    `cobranca_metricas` agrega e o filtro "Atraso" usa. O gestor lê a carteira.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

export type TomDoAtraso = "neutro" | "atencao" | "aviso" | "alerta" | "critico";
export type FaixaDeAtraso = "a_vencer" | "ate_30" | "ate_60" | "ate_90" | "acima_90";

export interface Atraso {
  dias: number;
  tom: TomDoAtraso;
  /** "vence hoje" · "1 dia" · "47 dias" · "vence em 3 dias". */
  rotulo: string;
}

/** `aaaa-mm-dd` → dias desde o vencimento (negativo: ainda vai vencer). */
export function diasDesdeVencimento(vencimento: string, hoje: Date = new Date()): number {
  const [ano, mes, dia] = vencimento.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return 0;
  const alvo = new Date(ano, mes - 1, dia).getTime();
  const zero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  return Math.round((zero - alvo) / DIA_MS);
}

export function tomDoAtraso(dias: number): TomDoAtraso {
  if (dias <= 0) return "neutro";
  if (dias <= 15) return "atencao";
  if (dias <= 30) return "aviso";
  if (dias <= 60) return "alerta";
  return "critico";
}

export function faixaDoAtraso(dias: number): FaixaDeAtraso {
  if (dias <= 0) return "a_vencer";
  if (dias <= 30) return "ate_30";
  if (dias <= 60) return "ate_60";
  if (dias <= 90) return "ate_90";
  return "acima_90";
}

export function atrasoDe(vencimento: string | null | undefined, hoje: Date = new Date()): Atraso | null {
  if (!vencimento) return null;
  const dias = diasDesdeVencimento(vencimento, hoje);
  let rotulo: string;
  if (dias === 0) rotulo = "vence hoje";
  else if (dias < 0) rotulo = dias === -1 ? "vence amanhã" : `vence em ${-dias} dias`;
  else rotulo = dias === 1 ? "1 dia" : `${dias} dias`;
  return { dias, tom: tomDoAtraso(dias), rotulo };
}

/** Faixas da carteira, na ordem em que aparecem na barra e no filtro. */
export const FAIXAS_DE_ATRASO: { faixa: FaixaDeAtraso; rotulo: string }[] = [
  { faixa: "ate_30", rotulo: "1 a 30 dias" },
  { faixa: "ate_60", rotulo: "31 a 60 dias" },
  { faixa: "ate_90", rotulo: "61 a 90 dias" },
  { faixa: "acima_90", rotulo: "Mais de 90 dias" },
  { faixa: "a_vencer", rotulo: "A vencer" },
];

/**
 * Recorte de vencimento que corresponde a uma faixa, para filtrar no banco por
 * `vencimento_mais_antigo` (o banco não sabe o "hoje" do navegador).
 * `gte`/`lte` em `aaaa-mm-dd`; ausente = sem limite daquele lado.
 */
export function recorteDeVencimento(
  faixa: FaixaDeAtraso,
  hoje: Date = new Date(),
): { gte?: string; lte?: string } {
  const diasAtras = (n: number) =>
    isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n));
  switch (faixa) {
    case "a_vencer":
      return { gte: diasAtras(0) };
    case "ate_30":
      return { gte: diasAtras(30), lte: diasAtras(1) };
    case "ate_60":
      return { gte: diasAtras(60), lte: diasAtras(31) };
    case "ate_90":
      return { gte: diasAtras(90), lte: diasAtras(61) };
    case "acima_90":
      return { lte: diasAtras(91) };
  }
}

/** Data local → `aaaa-mm-dd` (sem passar por UTC). */
export function isoDia(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** `aaaa-mm-dd` → `dd/mm` no ano corrente, `dd/mm/aa` fora dele. */
export function diaCurto(iso: string | null | undefined, hoje: Date = new Date()): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return Number(ano) === hoje.getFullYear() ? `${dia}/${mes}` : `${dia}/${mes}/${ano.slice(2)}`;
}

/** "agora" · "há 35 min" · "há 2 h" · "ontem" · "há 6 dias" · "dd/mm". */
export function haQuantoTempo(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const min = Math.floor((agora.getTime() - t) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = diasDesdeVencimento(isoDia(new Date(t)), agora);
  if (dias <= 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return diaCurto(isoDia(new Date(t)), agora);
}
