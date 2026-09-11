/**
 * Vigia o ENVIO do alerta do `infra-watchdog` — o andar de baixo do alarme.
 *
 * POR QUE ISTO EXISTE
 *
 * Quando o `infra-watchdog` detecta algo e o WhatsApp do alerta falha, ele
 * escreve `module='job_monitor', action='watchdog_alert', status='error'` em
 * `runtime_logs` e chama isso de "último recurso". Só que ninguém lê essa
 * prateleira — é exatamente a prateleira não-lida que criou o incidente que
 * motivou o watchdog. Alarme cujo defeito é invisível pelo mesmo motivo que
 * gerou o alarme.
 *
 * Quem fecha o círculo tem que ser OUTRO caminho. O watchdog vigiando o próprio
 * envio seria auto-referência: se ele estiver fora do ar, os dois lados calam
 * juntos. Por isso a vigilância mora aqui, no `cron-health-check`, que é outra
 * edge function, disparada por outro job de pg_cron.
 *
 * Lógica pura, sem import de Deno, para rodar no vitest.
 */

/**
 * Janela de observação. Falha de envio fica visível por um dia.
 *
 * O PISO NÃO É ESCOLHA — é derivado: o `infra-watchdog` tem cooldown de 30 min
 * por assunto, então uma falha PERSISTENTE só se re-registra a cada 30 min.
 * Qualquer janela menor que isso abre um vão: falha em T, próxima em T+30, e um
 * health-check em T+31 com janela de 30 não vê nada enquanto o problema
 * continua. **A janela tem que exceder o cooldown do watchdog.**
 *
 * 1440 min está ordens de grandeza acima do piso e coincide com o dia útil de
 * quem conserta. Se alguém achar 24 h exagerado e encolher, o limite inferior é
 * 30 min — abaixo disso o detector fica cego com o defeito no ar.
 */
export const WATCHDOG_DELIVERY_LOOKBACK_MINUTES = 1440;

export interface WatchdogDeliveryFailureRow {
  /** ISO timestamp de `runtime_logs.created_at`. */
  created_at: string;
}

export interface WatchdogDeliveryReport {
  failing: boolean;
  /**
   * Quantas falhas de envio dentro da janela. NULO quando não deu para contar
   * — "não sei" e "zero" não podem colapsar no mesmo número, senão quem ler
   * `runtime_logs` depois não separa saúde de cegueira.
   */
  count: number | null;
  /** A mais antiga da janela — o "desde quando". */
  oldest_at: string | null;
  /** Falso quando a leitura falhou. É o discriminador do `count` nulo. */
  readable: boolean;
  /** Nulo quando não há falha. Silêncio é o normal. */
  message: string | null;
}

/**
 * Decide se o envio do watchdog está quebrado, a partir das linhas de erro.
 *
 * A janela é aplicada AQUI, e não só na consulta: assim o teste exercita o
 * corte, e uma consulta que traga demais não vira alerta eterno.
 *
 * Uma falha só já conta. Alerta que não saiu é alerta perdido — não existe
 * "pouco". O que evita ruído é a janela, não um limiar: 24 h depois de
 * consertado, o silêncio volta sozinho.
 */
export function assessWatchdogDelivery(
  rows: WatchdogDeliveryFailureRow[],
  now: Date = new Date(),
  lookbackMinutes: number = WATCHDOG_DELIVERY_LOOKBACK_MINUTES,
): WatchdogDeliveryReport {
  const cutoff = now.getTime() - lookbackMinutes * 60_000;

  const dentroDaJanela = rows
    .map(r => ({ raw: r.created_at, at: Date.parse(r.created_at) }))
    // Timestamp ilegível não é motivo para calar o alerta inteiro, mas também
    // não pode virar "desde 1970" no texto: descarta a linha e segue.
    .filter(r => Number.isFinite(r.at) && r.at >= cutoff)
    .sort((a, b) => a.at - b.at);

  if (dentroDaJanela.length === 0) {
    return { failing: false, count: 0, oldest_at: null, readable: true, message: null };
  }

  const count = dentroDaJanela.length;
  const oldest = dentroDaJanela[0].raw;
  const plural = count === 1 ? "alerta do watchdog não saiu" : "alertas do watchdog não saíram";

  return {
    failing: true,
    count,
    oldest_at: oldest,
    readable: true,
    message:
      `${count} ${plural} — o mais antigo em ${oldest} ` +
      `(janela de ${lookbackMinutes} min). O infra-watchdog detectou e não conseguiu avisar.`,
  };
}
