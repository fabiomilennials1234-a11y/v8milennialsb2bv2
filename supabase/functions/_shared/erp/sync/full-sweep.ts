/**
 * Varredura completa diária das cobranças do Toth — o estado dela, puro.
 *
 * O Toth omite título pago da resposta de `/cobrancas` (Chamado 065e4890). O
 * sync de janela (±45 dias, a cada 2h) só prova baixa de quem vence DENTRO da
 * janela; título vencido antes dela e pago depois só fecha numa volta SEM
 * janela, que `reconcileMissingTitulos` trata com `window: "full"`.
 *
 * 🔴 Cursor próprio. Até aqui `full` e janela dividiam `cobrancas_cursor`, e uma
 * volta precisa de ~5 execuções de 3.000 clientes. Intercaladas, cada modo
 * avançava o cursor do outro: nenhuma das duas voltas cobria a base inteira, e
 * nada avisava. Com dois cursores, cada volta é inteira.
 */

export type SweepMode = "window" | "full";

/**
 * Intervalo mínimo entre duas voltas completas disparadas pelo cron diário.
 *
 * O cron dispara 10 vezes por madrugada (02:00–03:55 BRT) porque a volta
 * precisa de ~5; sem este portão, as execuções de sobra começariam uma segunda
 * volta na mesma noite — o dobro de carga no servidor do cliente, sem ganho.
 * 20h, e não 24h: a volta que fechou às 03:40 de ontem tem que liberar a das
 * 02:00 de hoje, 22h20 depois. E não menos que ~2h, a largura da janela do
 * cron, ou a mesma madrugada rodaria duas vezes.
 */
export const DAILY_FULL_SWEEP_MIN_INTERVAL_HOURS = 20;

/**
 * A execução diária deve rodar?
 *
 * Volta pela metade (cursor preenchido) SEMPRE continua: se o ERP caiu no meio
 * da madrugada, a próxima execução retoma de onde parou, não espera 20h.
 */
export function dailyFullSweepDue(
  state: { fullCursor: string | null; lastSweepAt: string | null },
  now: Date,
): boolean {
  if (state.fullCursor) return true;
  if (!state.lastSweepAt) return true;
  const last = Date.parse(state.lastSweepAt);
  // Data ilegível não pode travar a varredura para sempre.
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= DAILY_FULL_SWEEP_MIN_INTERVAL_HOURS * 3_600_000;
}

/** O cursor de onde este modo retoma. */
export function sweepCursor(
  mode: SweepMode,
  conn: { cobrancas_cursor?: string | null; cobrancas_full_cursor?: string | null },
): string | null {
  return (mode === "full" ? conn.cobrancas_full_cursor : conn.cobrancas_cursor) ?? null;
}

/**
 * O que gravar em `toth_connections` ao fim de uma execução: só o cursor do
 * próprio modo. `nextCursor` null = a volta terminou; no modo `full`, é aí que
 * se marca `last_cobrancas_full_sweep_at`, que o portão diário lê.
 */
export function endOfRunCursorPatch(
  mode: SweepMode,
  nextCursor: string | null,
  nowIso: string,
): Record<string, string | null> {
  if (mode === "window") return { cobrancas_cursor: nextCursor };
  return nextCursor
    ? { cobrancas_full_cursor: nextCursor }
    : { cobrancas_full_cursor: null, last_cobrancas_full_sweep_at: nowIso };
}
