/**
 * Pool de despacho de Workflow Executions + controlador de escala.
 *
 * Ver ADR-0023 e .specs/motor-automacoes/PLANO-A-B.md.
 *
 * Por que existe: a carga é I/O-bound (medido: 4,88s por execução, ~94% espera —
 * 3,38s por nó `action` é o provedor de WhatsApp respondendo). Processar isso num
 * `for … await` sequencial dá vazão de 1 ÷ 4,88s ≈ 12/min, e nenhum `batch_size`
 * muda isso. Vazão = concorrência ÷ latência; só a concorrência é nossa.
 *
 * O miolo aqui é PURO de propósito (`decidePool`, `runWithPool` com relógio
 * injetado) para ser testável sem banco e sem Deno.serve.
 */

export type PoolMode = "auto" | "pinned";

export interface PoolConfig {
  mode: PoolMode;
  size: number;
  min: number;
  max: number;
  budgetMs: number;
  /** Quanto reivindicar por vez. Derivado: 2× o pool. */
  chunk: number;
  /** Vagas simultâneas por org. Derivado: metade do pool, nunca < 1. */
  perOrg: number;
  satStreak: number;
  idleStreak: number;
  lastChangeAt: number;
}

export const POOL_DEFAULTS = {
  mode: "auto" as PoolMode,
  size: 4,
  min: 4,
  max: 16,
  budgetMs: 45_000,
} as const;

/** Regras do controlador — ver tabela no PLANO-A-B.md. */
export const CONTROLLER = {
  /** Invocações seguidas saturadas para subir. */
  SAT_STREAK_TO_UP: 3,
  /** Invocações seguidas ociosas para descer. */
  IDLE_STREAK_TO_DOWN: 20,
  /** Sobe de 2 em 2, desce de 1 em 1: ficar pequeno machuca cliente, ficar grande só ocupa vaga. */
  UP_STEP: 2,
  DOWN_STEP: 1,
  /** Carência após qualquer mudança. Sem ela o controlador oscila. */
  COOLDOWN_MS: 5 * 60_000,
  /** Abaixo disso de orçamento gasto, com a fila drenada, conta como ociosa. */
  IDLE_BUDGET_FRACTION: 0.3,
} as const;

export function derivePerOrg(size: number): number {
  return Math.max(1, Math.floor(size / 2));
}

export function deriveChunk(size: number): number {
  return Math.max(1, size * 2);
}

export interface RunOutcome {
  /** Orçamento acabou com trabalho ainda vencido na fila. */
  saturated: boolean;
  /** Fila drenou usando pouco do orçamento. */
  idle: boolean;
}

export interface PoolDecision {
  size: number;
  satStreak: number;
  idleStreak: number;
  changed: boolean;
  reason: "pinned" | "cooldown" | "up" | "down" | "hold" | "at_ceiling" | "at_floor";
}

/**
 * Controlador. Função PURA — sem relógio global, sem banco.
 *
 * Sinal é SATURAÇÃO, não Lag. Lag é indicador atrasado: quando ele sobe, o cliente
 * já esperou. Saturação é medida no instante em que acontece.
 */
export function decidePool(cfg: PoolConfig, outcome: RunOutcome, nowMs: number): PoolDecision {
  if (cfg.mode === "pinned") {
    // Humano vence o controlador. Sem isso, o botão de pânico seria sobrescrito
    // pela própria máquina 3 minutos depois.
    return { size: cfg.size, satStreak: 0, idleStreak: 0, changed: false, reason: "pinned" };
  }

  const satStreak = outcome.saturated ? cfg.satStreak + 1 : 0;
  const idleStreak = outcome.idle ? cfg.idleStreak + 1 : 0;

  if (nowMs - cfg.lastChangeAt < CONTROLLER.COOLDOWN_MS) {
    // Streaks seguem acumulando durante a carência — só a mudança espera.
    return { size: cfg.size, satStreak, idleStreak, changed: false, reason: "cooldown" };
  }

  if (satStreak >= CONTROLLER.SAT_STREAK_TO_UP) {
    const next = Math.min(cfg.max, cfg.size + CONTROLLER.UP_STEP);
    return {
      size: next,
      satStreak: 0,
      idleStreak: 0,
      changed: next !== cfg.size,
      reason: next === cfg.size ? "at_ceiling" : "up",
    };
  }

  if (idleStreak >= CONTROLLER.IDLE_STREAK_TO_DOWN) {
    const next = Math.max(cfg.min, cfg.size - CONTROLLER.DOWN_STEP);
    return {
      size: next,
      satStreak: 0,
      idleStreak: 0,
      changed: next !== cfg.size,
      reason: next === cfg.size ? "at_floor" : "down",
    };
  }

  return { size: cfg.size, satStreak, idleStreak, changed: false, reason: "hold" };
}

export interface PoolRunResult<T> {
  processed: number;
  /** Reivindicados que o orçamento não alcançou. Devolver para a fila. */
  leftover: T[];
}

/**
 * Executa `work` sobre `items` com teto global e teto por org, respeitando um prazo.
 *
 * O teto por org NÃO é proteção de ban (ver ADR-0023, decisão 2) — é isolamento
 * multi-tenant: impede que uma org ocupe o motor inteiro.
 *
 * `now` é injetado para o teste controlar o relógio sem esperar de verdade.
 */
export async function runWithPool<T>(
  items: T[],
  orgOf: (item: T) => string,
  work: (item: T) => Promise<void>,
  opts: { size: number; perOrg: number; deadlineMs: number; now?: () => number },
): Promise<PoolRunResult<T>> {
  const now = opts.now ?? (() => Date.now());
  const pending = items.slice();
  const inflight = new Map<string, number>();
  const running = new Set<Promise<void>>();
  let processed = 0;

  /** Primeiro pendente cuja org ainda tem vaga. Pula quem estourou o teto por org. */
  const takeNext = (): T | undefined => {
    for (let i = 0; i < pending.length; i++) {
      const org = orgOf(pending[i]);
      if ((inflight.get(org) ?? 0) < opts.perOrg) return pending.splice(i, 1)[0];
    }
    return undefined;
  };

  while (true) {
    while (running.size < opts.size && now() < opts.deadlineMs) {
      const item = takeNext();
      if (item === undefined) break;
      const org = orgOf(item);
      inflight.set(org, (inflight.get(org) ?? 0) + 1);
      const p = work(item)
        .catch(() => {
          // processExecution já trata e marca o próprio erro; aqui só não derrubamos o pool.
        })
        .finally(() => {
          inflight.set(org, Math.max(0, (inflight.get(org) ?? 1) - 1));
          running.delete(p);
          processed++;
        });
      running.add(p);
    }

    if (running.size === 0) break;
    await Promise.race(running);
    if (pending.length === 0 && running.size === 0) break;
    if (now() >= opts.deadlineMs && running.size === 0) break;
  }

  await Promise.allSettled(running);
  return { processed, leftover: pending };
}

// ─────────────────────────────────────────────────────────────────────────────
// Borda: leitura/escrita. O miolo acima é puro; tudo que toca banco fica aqui.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `per_org_cap` passado à RPC. Alto de propósito: deixa de ser o freio.
 * O default de 5 estrangulava toda org a 5 execuções/min. Ver ADR-0023.
 */
export const RPC_PER_ORG_CAP = 1000;

type Db = {
  from: (t: string) => any;
};

const KEYS = {
  mode: "workflow_pool_mode",
  size: "workflow_pool_size",
  min: "workflow_pool_min",
  max: "workflow_pool_max",
  budget: "workflow_run_budget_ms",
  lastChange: "workflow_pool_last_change",
  sat: "workflow_pool_sat_streak",
  idle: "workflow_pool_idle_streak",
} as const;

/** Lê os parâmetros. Ausência de chave cai no padrão conservador, nunca em ilimitado. */
export async function readPoolConfig(supabase: Db): Promise<PoolConfig> {
  const raw = new Map<string, string>();
  try {
    const { data } = await supabase
      .from("cron_config")
      .select("key, value")
      .in("key", Object.values(KEYS));
    for (const r of (data ?? []) as { key: string; value: string }[]) raw.set(r.key, r.value);
  } catch (err) {
    console.error("[workflow-pool] cron_config ilegível, usando padrões:", err);
  }

  const num = (k: string, fallback: number) => {
    const n = Number(raw.get(k));
    return Number.isFinite(n) ? n : fallback;
  };

  const min = Math.max(1, num(KEYS.min, POOL_DEFAULTS.min));
  const max = Math.max(min, num(KEYS.max, POOL_DEFAULTS.max));
  const size = Math.min(max, Math.max(min, num(KEYS.size, POOL_DEFAULTS.size)));
  const mode: PoolMode = raw.get(KEYS.mode) === "pinned" ? "pinned" : "auto";
  const lastChangeAt = Date.parse(raw.get(KEYS.lastChange) ?? "") || 0;

  return {
    mode,
    size,
    min,
    max,
    budgetMs: Math.max(5_000, num(KEYS.budget, POOL_DEFAULTS.budgetMs)),
    chunk: deriveChunk(size),
    perOrg: derivePerOrg(size),
    satStreak: Math.max(0, num(KEYS.sat, 0)),
    idleStreak: Math.max(0, num(KEYS.idle, 0)),
    lastChangeAt,
  };
}

const put = (supabase: Db, key: string, value: string) =>
  supabase.from("cron_config").update({ value }).eq("key", key);

/**
 * Persiste a decisão do controlador.
 *
 * Invocações podem se sobrepor. A escrita do tamanho usa guarda otimista sobre
 * `workflow_pool_last_change`: se outra invocação já mudou, esta desiste em vez
 * de sobrescrever — dois workers não somam degraus.
 */
export async function persistPoolDecision(
  supabase: Db,
  cfg: PoolConfig,
  decision: PoolDecision,
): Promise<boolean> {
  try {
    if (decision.reason === "pinned") return false;

    await put(supabase, KEYS.sat, String(decision.satStreak));
    await put(supabase, KEYS.idle, String(decision.idleStreak));
    if (!decision.changed) return false;

    const prev = new Date(cfg.lastChangeAt).toISOString();
    const next = new Date().toISOString();
    const { data } = await supabase
      .from("cron_config")
      .update({ value: next })
      .eq("key", KEYS.lastChange)
      .eq("value", prev)
      .select("key");

    if (!data || (data as unknown[]).length === 0) {
      console.log("[workflow-pool] outra invocação já ajustou o pool; desistindo");
      return false;
    }

    await put(supabase, KEYS.size, String(decision.size));
    console.log(`[workflow-pool] pool ${cfg.size} → ${decision.size} (${decision.reason})`);
    return true;
  } catch (err) {
    console.error("[workflow-pool] falha ao persistir decisão:", err);
    return false;
  }
}

/**
 * Devolve à fila o que foi reivindicado e o orçamento não alcançou.
 *
 * Melhor esforço: só roda na saída limpa. Se a função for morta pelo teto de
 * wall-clock, a rede continua sendo o stale de 10 min — que NÃO baixamos, porque
 * execução medida chega a 139s e janela curta reprocessaria algo em voo,
 * mandando a mesma mensagem duas vezes ao lead.
 */
export async function releaseClaimed(supabase: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  try {
    const { data } = await supabase
      .from("workflow_executions")
      .update({ status: "running" })
      .in("id", ids)
      .eq("status", "processing")
      .select("id");
    return ((data ?? []) as unknown[]).length;
  } catch (err) {
    console.error("[workflow-pool] falha ao devolver reivindicadas:", err);
    return 0;
  }
}
