/**
 * Em que prazo cai cada item da Revisão: Atrasadas · Hoje · Amanhã · Esta
 * semana · Depois.
 *
 * O corte é por DIA no fuso da ORGANIZAÇÃO — a mesma régua de
 * `follow-up-atraso.ts` (que decide o selo vermelho). Se este arquivo cortasse
 * diferente, um item poderia estar no grupo "Hoje" e com selo de atrasado ao
 * mesmo tempo.
 *
 * "Esta semana" vai até o domingo (semana de segunda a domingo). No sábado e
 * no domingo o grupo fica vazio por construção: amanhã já é o fim da semana.
 */
import { zonedDateParts, zonedDayStartOfYMD } from "@/shared/time/zoned-day";

export type Prazo = "atrasadas" | "hoje" | "amanha" | "semana" | "depois";

export interface CortesDosPrazos {
  hoje: Date;
  amanha: Date;
  depoisDeAmanha: Date;
  /** Início da próxima segunda — limite superior EXCLUSIVO de "Esta semana". */
  proximaSegunda: Date;
  timeZone: string;
}

function inicioDoDia(y: number, m: number, d: number, somaDias: number, tz: string): Date {
  // A soma de dias acontece no calendário (UTC puro), não em milissegundos:
  // atravessa virada de mês/ano e horário de verão sem errar o dia.
  const t = new Date(Date.UTC(y, m - 1, d + somaDias));
  return zonedDayStartOfYMD(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), tz);
}

export function cortesDosPrazos(timezone: string | null | undefined, agora: Date = new Date()): CortesDosPrazos {
  const tz = timezone ?? "UTC";
  const { y, m, d, weekdayMon0 } = zonedDateParts(agora, tz);
  return {
    hoje: inicioDoDia(y, m, d, 0, tz),
    amanha: inicioDoDia(y, m, d, 1, tz),
    depoisDeAmanha: inicioDoDia(y, m, d, 2, tz),
    proximaSegunda: inicioDoDia(y, m, d, 7 - weekdayMon0, tz),
    timeZone: tz,
  };
}

export function prazoDe(data: Date, cortes: CortesDosPrazos): Prazo {
  const t = data.getTime();
  if (t < cortes.hoje.getTime()) return "atrasadas";
  if (t < cortes.amanha.getTime()) return "hoje";
  if (t < cortes.depoisDeAmanha.getTime()) return "amanha";
  if (t < cortes.proximaSegunda.getTime()) return "semana";
  return "depois";
}
