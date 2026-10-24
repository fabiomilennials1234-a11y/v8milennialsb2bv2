/**
 * Sonda de CPU do `infra-watchdog`.
 *
 * Nasceu do incidente de 2026-10-01: duas requisições presas num laço infinito
 * (RAISE com SQLSTATE 40001, que o PostgREST repete sem limite) ocuparam os 2 vCPU
 * do banco por 5 h. O watchdog já vigiava conexões, e conexões ficaram em 61/90 —
 * abaixo do teto. Nenhuma sonda olhava CPU, e a CPU era o incidente inteiro.
 *
 * O Postgres não enxerga a CPU da máquina; quem enxerga é o node exporter que a
 * Supabase publica em `/customer/v1/privileged/metrics` (formato Prometheus).
 * `node_cpu_seconds_total` é contador acumulado, então uma leitura sozinha não diz
 * nada: a porcentagem sai da DIFERENÇA entre duas leituras. A função é stateless e
 * roda a cada 2 min, por isso a leitura anterior viaja em `cron_config`.
 *
 * `steal` conta como ocupado de propósito. No compute compartilhado, quando os
 * créditos de CPU acabam, a máquina é estrangulada e o tempo roubado aparece como
 * `steal` — é a CPU que o usuário sente, mesmo com pouca query rodando.
 *
 * Vive separado do watchdog para ser testável sem subir a edge function.
 */

export type CpuCounters = { total: number; idle: number };

export type CpuState = {
  /** Epoch ms da leitura. */
  t: number;
  total: number;
  idle: number;
  /** Leituras seguidas acima do teto. */
  streak: number;
  /** Última porcentagem calculada, para quem olhar `cron_config` à mão. */
  pct: number | null;
};

export type CpuStep = { state: CpuState; pct: number | null; alert: boolean };

/** Duas leituras mais distantes que isto não formam média confiável. */
export const CPU_MAX_GAP_MS = 10 * 60_000;

const CPU_LINE = /^node_cpu_seconds_total\{([^}]*)\}\s+([0-9.eE+-]+)/;
const LABEL = /(\w+)="([^"]*)"/g;

function labels(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(LABEL)) out[m[1]] = m[2];
  return out;
}

/**
 * Soma os contadores de todos os núcleos. Ocioso = `idle` + `iowait`.
 *
 * Se o texto trouxer métricas de mais de um serviço (`service_type`), conta só o
 * banco: somar a CPU de outra máquina diluiria justamente o sinal que importa.
 */
export function parseCpuCounters(prom: string): CpuCounters | null {
  const linhas: { l: Record<string, string>; v: number }[] = [];
  for (const line of prom.split("\n")) {
    const m = CPU_LINE.exec(line);
    if (!m) continue;
    const v = Number(m[2]);
    if (!Number.isFinite(v)) continue;
    linhas.push({ l: labels(m[1]), v });
  }
  const temServico = linhas.some((x) => x.l.service_type !== undefined);
  const doBanco = temServico ? linhas.filter((x) => x.l.service_type === "db") : linhas;
  if (doBanco.length === 0) return null;

  let total = 0;
  let idle = 0;
  for (const { l, v } of doBanco) {
    total += v;
    if (l.mode === "idle" || l.mode === "iowait") idle += v;
  }
  return total > 0 ? { total, idle } : null;
}

/** RAM em uso (%), quando o texto traz as duas métricas. Só contexto no aviso. */
export function parseMemoryPct(prom: string): number | null {
  const pick = (name: string) => {
    const m = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)`, "m").exec(prom);
    return m ? Number(m[1]) : NaN;
  };
  const total = pick("node_memory_MemTotal_bytes");
  const livre = pick("node_memory_MemAvailable_bytes");
  if (!Number.isFinite(total) || !Number.isFinite(livre) || total <= 0) return null;
  return Math.round(((total - livre) / total) * 100);
}

/**
 * Avança o estado com a leitura nova.
 *
 * Sem leitura anterior, com contador que andou para trás (reboot) ou com intervalo
 * grande demais, a leitura vira só o ponto de partida: nada a comparar ainda.
 * O aviso sai quando a sequência acima do teto alcança `needed` leituras — um pico
 * de 2 min não é incidente, 10 min seguidos é.
 */
export function stepCpu(
  prev: CpuState | null,
  sample: CpuCounters,
  now: number,
  thresholdPct: number,
  needed: number,
): CpuStep {
  const dTotal = prev ? sample.total - prev.total : 0;
  const dIdle = prev ? sample.idle - prev.idle : 0;
  const valido = prev !== null && now - prev.t > 0 && now - prev.t <= CPU_MAX_GAP_MS &&
    dTotal > 0 && dIdle >= 0 && dIdle <= dTotal;

  if (!valido) {
    return { state: { t: now, ...sample, streak: 0, pct: null }, pct: null, alert: false };
  }

  const pct = Math.round(((dTotal - dIdle) / dTotal) * 100);
  const streak = pct >= thresholdPct ? prev.streak + 1 : 0;
  return { state: { t: now, ...sample, streak, pct }, pct, alert: streak >= needed };
}

/** Estado salvo em `cron_config` (texto). Qualquer coisa estranha = sem estado. */
export function parseCpuState(raw: string | null | undefined): CpuState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    const ok = [s.t, s.total, s.idle, s.streak].every((n) => typeof n === "number" && Number.isFinite(n));
    return ok ? { t: s.t, total: s.total, idle: s.idle, streak: s.streak, pct: s.pct ?? null } : null;
  } catch {
    return null;
  }
}

export function buildCpuAlertText(
  p: { pct: number; minutes: number; thresholdPct: number; memPct: number | null },
): string {
  const ram = p.memPct === null ? "" : ` · RAM ${p.memPct}%`;
  return (
    `🔴 *CPU do banco alta há ${p.minutes} min*\n\n` +
    `Agora: *${p.pct}%*${ram} (teto ${p.thresholdPct}%)\n\n` +
    `O produto fica lento e, se continuar, para de responder — foi assim em ` +
    `01/10, 5 h com o app preso na tela de abertura.\n\n` +
    `1º suspeito: requisição em laço. Rodar no SQL Editor:\n` +
    "`select pid, application_name, now()-backend_start, left(query,80) " +
    "from pg_stat_activity where state <> 'idle' order by query_start;`\n" +
    `Mesmo pid ativo há muito tempo com a mesma query = laço; ` +
    "`select pg_terminate_backend(<pid>);` derruba.\n\n" +
    `Sem query pesada e CPU alta assim mesmo = créditos de CPU esgotados ` +
    `(compute compartilhado): a máquina se recupera sozinha, devagar.`
  );
}
