/**
 * As duas fronteiras do dia da ORGANIZAÇÃO, em ISO — prontas para virar filtro
 * do PostgREST.
 *
 * Mora em `shared/time` e não num módulo porque três bounded contexts já
 * precisam do MESMO corte: `analytics` (cartões do dashboard), `engagement`
 * (lista de follow-ups) e a aba Comando. Quando cada um calculava o seu, os
 * números discordavam exatamente na virada do dia — que é quando alguém está
 * olhando. Também é o que impede um ciclo `analytics ↔ engagement`.
 *
 * O corte é o da org (`organizations.timezone`), nunca o do browser: dois
 * vendedores da mesma organização, em fusos diferentes, têm de ver a mesma
 * lista de "atrasados". Vendedor viajando não muda o que está atrasado.
 */

import { zonedDayStart } from "./zoned-day";

export interface LimitesDoDia {
  /** Instante em que o dia de hoje começou, no fuso da org. */
  inicioDeHoje: string;
  /** Instante em que o dia de amanhã começa — limite superior EXCLUSIVO. */
  inicioDeAmanha: string;
}

export function limitesDoDia(
  timezone: string | null | undefined,
  agora: Date = new Date(),
): LimitesDoDia {
  // `timezone` chega null nos primeiros renders (a query da org não resolveu).
  // O fallback UTC é o mesmo que `zoned-day` já aplica quando o Intl rejeita a
  // zona, e no Brasil (UTC-3) erra para o lado seguro: o corte UTC é mais cedo,
  // então nunca acusa como atrasado algo de hoje.
  const tz = timezone ?? "UTC";
  const inicio = zonedDayStart(agora, tz);
  // +36h e re-normaliza: atravessa a virada de horário de verão sem produzir
  // um "dia" de 0h nem de 48h. Somar 24h fixas quebraria no dia da mudança.
  const amanha = zonedDayStart(new Date(inicio.getTime() + 36 * 3_600_000), tz);
  return {
    inicioDeHoje: inicio.toISOString(),
    inicioDeAmanha: amanha.toISOString(),
  };
}
