import type { DateRange } from "react-day-picker";
import { zonedDateParts, zonedDayEndOfYMD, zonedDayStartOfYMD } from "@/shared/time/zoned-day";

/**
 * Período de criação do lead, em instantes ISO cortados na fronteira de dia do
 * fuso da ORG (não do browser) — o mesmo corte que o Comando usa, para o número
 * da lista bater com o do card.
 */
export interface PeriodoDeCriacao {
  from: string;
  to: string;
}

export interface PresetDePeriodo {
  key: "hoje" | "7-dias" | "30-dias" | "este-mes" | "mes-passado";
  label: string;
  periodo: PeriodoDeCriacao;
}

interface Ymd { y: number; m: number; d: number }

/** Soma dias a uma data-calendário sem passar por fuso (aritmética em UTC). */
function somaDias({ y, m, d }: Ymd, dias: number): Ymd {
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function entre(de: Ymd, ate: Ymd, timeZone: string): PeriodoDeCriacao {
  return {
    from: zonedDayStartOfYMD(de.y, de.m, de.d, timeZone).toISOString(),
    to: zonedDayEndOfYMD(ate.y, ate.m, ate.d, timeZone).toISOString(),
  };
}

const doDate = (d: Date): Ymd => ({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });

/**
 * Dias escolhidos no calendário (getters locais: o calendário devolve o dia
 * clicado como data local) → período no fuso da org. Sem fim, vale um dia só;
 * intervalo escolhido de trás para frente é endireitado.
 */
export function periodoDosDias(inicio: Date, fim: Date | undefined, timeZone: string): PeriodoDeCriacao {
  const a = doDate(inicio);
  const b = fim ? doDate(fim) : a;
  const ordem = Date.UTC(a.y, a.m - 1, a.d) <= Date.UTC(b.y, b.m - 1, b.d);
  return ordem ? entre(a, b, timeZone) : entre(b, a, timeZone);
}

export function presetsDePeriodo(agora: Date, timeZone: string): PresetDePeriodo[] {
  const { y, m, d } = zonedDateParts(agora, timeZone);
  const hoje: Ymd = { y, m, d };
  const ultimoDoMesAnterior = new Date(Date.UTC(y, m - 1, 0));
  return [
    { key: "hoje", label: "Hoje", periodo: entre(hoje, hoje, timeZone) },
    { key: "7-dias", label: "Últimos 7 dias", periodo: entre(somaDias(hoje, -6), hoje, timeZone) },
    { key: "30-dias", label: "Últimos 30 dias", periodo: entre(somaDias(hoje, -29), hoje, timeZone) },
    { key: "este-mes", label: "Este mês", periodo: entre({ y, m, d: 1 }, hoje, timeZone) },
    {
      key: "mes-passado",
      label: "Mês passado",
      periodo: entre(
        { y: ultimoDoMesAnterior.getUTCFullYear(), m: ultimoDoMesAnterior.getUTCMonth() + 1, d: 1 },
        {
          y: ultimoDoMesAnterior.getUTCFullYear(),
          m: ultimoDoMesAnterior.getUTCMonth() + 1,
          d: ultimoDoMesAnterior.getUTCDate(),
        },
        timeZone,
      ),
    },
  ];
}

/** Instante ISO → data local (meia-noite do browser) do dia-calendário da org, para o `Calendar` marcar. */
function diaDaOrg(iso: string, timeZone: string): Date {
  const { y, m, d } = zonedDateParts(new Date(iso), timeZone);
  return new Date(y, m - 1, d);
}

export function calendarioDoPeriodo(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): DateRange | undefined {
  if (!from) return undefined;
  return { from: diaDaOrg(from, timeZone), to: to ? diaDaOrg(to, timeZone) : undefined };
}

function dia(iso: string, timeZone: string): string {
  const { y, m, d } = zonedDateParts(new Date(iso), timeZone);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

export function rotuloDoPeriodo(from: string | undefined, to: string | undefined, timeZone: string): string {
  if (from && to) {
    const a = dia(from, timeZone);
    const b = dia(to, timeZone);
    return a === b ? a : `${a} — ${b}`;
  }
  if (from) return `a partir de ${dia(from, timeZone)}`;
  if (to) return `até ${dia(to, timeZone)}`;
  return "";
}
