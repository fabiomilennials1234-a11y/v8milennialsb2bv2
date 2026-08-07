/**
 * Regras de decisão dos guard-rails do backfill de histórico.
 *
 * Separadas do `index.ts` porque decisão pura se testa sem banco, sem provedor e
 * sem rede — e porque foi justamente uma decisão de uma linha só
 * (`job.scope !== "full" && ...`) que soltou o teto de volume e derrubou a
 * produção em 2026-08-06.
 */

export type GuardConfig = {
  maxPressurePct: number;
  maxRowsPerMin: number;
  fullWindowStart: number;
  fullWindowEnd: number;
};

export const GUARD_DEFAULTS: GuardConfig = {
  maxPressurePct: 60,
  maxRowsPerMin: 400,
  fullWindowStart: 3,
  fullWindowEnd: 9,
};

const CONFIG_KEYS: Record<keyof GuardConfig, string> = {
  maxPressurePct: "history_sync_max_pressure_pct",
  maxRowsPerMin: "history_sync_max_rows_per_min",
  fullWindowStart: "history_sync_full_window_start",
  fullWindowEnd: "history_sync_full_window_end",
};

/**
 * Converte as linhas de `cron_config` em configuração tipada.
 *
 * Valor ausente, vazio ou não numérico cai no default. A tabela guarda texto
 * livre e é editada à mão durante incidente — um dedo errado não pode desligar
 * o freio em silêncio.
 */
export function parseGuardConfig(
  rows: Array<{ key: string; value: string | null }> | null | undefined,
  defaults: GuardConfig = GUARD_DEFAULTS,
): GuardConfig {
  const map = new Map((rows ?? []).map(r => [r.key, r.value]));
  const num = (configKey: string, fallback: number): number => {
    const raw = map.get(configKey);
    if (raw === null || raw === undefined || String(raw).trim() === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    maxPressurePct: num(CONFIG_KEYS.maxPressurePct, defaults.maxPressurePct),
    maxRowsPerMin: num(CONFIG_KEYS.maxRowsPerMin, defaults.maxRowsPerMin),
    fullWindowStart: num(CONFIG_KEYS.fullWindowStart, defaults.fullWindowStart),
    fullWindowEnd: num(CONFIG_KEYS.fullWindowEnd, defaults.fullWindowEnd),
  };
}

/**
 * A hora atual está dentro da janela em que `scope=full` pode rodar?
 *
 * Trata janela que cruza a meia-noite UTC (ex.: 22→4), porque o padrão do
 * projeto é raciocinar em horário de Brasília e a conversão pode empurrar o
 * início para depois do fim.
 */
export function insideFullWindow(cfg: GuardConfig, now: Date): boolean {
  const hour = now.getUTCHours();
  return cfg.fullWindowStart <= cfg.fullWindowEnd
    ? hour >= cfg.fullWindowStart && hour < cfg.fullWindowEnd
    : hour >= cfg.fullWindowStart || hour < cfg.fullWindowEnd;
}

/**
 * Esta conversa já rendeu o bastante e deve ser encerrada?
 *
 * `scope=full` significa "quero o histórico inteiro desta conversa", então lá o
 * teto por conversa não se aplica — o que segura o job é o teto global
 * (`max_messages_per_chat × max_chats`), avaliado à parte.
 *
 * Antes esta regra vivia embutida numa condição que comparava o total do JOB
 * contra um limite chamado "per_chat". Errava nos dois sentidos: em `full`
 * soltava tudo, e fora de `full` marcava como concluída qualquer conversa
 * aberta depois que o job passasse do limite, independentemente do que aquela
 * conversa tivesse rendido.
 */
export function reachedChatCap(
  scope: string,
  fetchedThisChat: number,
  maxMessagesPerChat: number,
): boolean {
  if (scope === "full") return false;
  if (!Number.isFinite(maxMessagesPerChat) || maxMessagesPerChat <= 0) return false;
  return fetchedThisChat >= maxMessagesPerChat;
}

/** Teto de volume do job inteiro, válido para todo escopo — inclusive `full`. */
export function reachedGlobalCap(
  totalFetched: number,
  maxMessagesPerChat: number,
  maxChats: number,
): boolean {
  const cap = maxMessagesPerChat * maxChats;
  if (!Number.isFinite(cap) || cap <= 0) return false;
  return totalFetched >= cap;
}
