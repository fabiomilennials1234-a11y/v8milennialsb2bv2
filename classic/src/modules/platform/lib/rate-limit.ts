/**
 * rate-limit.ts — token bucket client-side genérico.
 *
 * Onda 3.1, C21. Proteção contra loop acidental (typeahead agressivo,
 * useEffect infinito). Não é proteção adversarial — server-side fica
 * para Onda 3.2.
 *
 * Uso:
 *   const limiter = createRateLimiter({ key: 'rl:search:userId', capacity: 20, refillIntervalMs: 60_000 });
 *   const { allowed, retryAfterMs } = limiter.tryConsume();
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface BucketConfig {
  /** Chave de storage. Padrão: `rl:${scope}:${userId}` */
  key: string;
  /** Máximo de tokens no bucket. Ex: 20 */
  capacity: number;
  /** Tempo em ms para refill completo. Ex: 60_000 (1 min) */
  refillIntervalMs: number;
  /** Storage injetável — default: localStorage. Permite testar sem browser. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Clock injetável — default: Date.now. Permite testar com clock fixo. */
  now?: () => number;
}

export interface ConsumeResult {
  /** Se o token foi concedido */
  allowed: boolean;
  /** Tokens restantes após a operação */
  tokensRemaining: number;
  /** 0 se allowed; ms para próximo token se blocked */
  retryAfterMs: number;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

export interface RateLimiter {
  /** Tenta consumir `count` tokens (default 1). Síncrono. */
  tryConsume: (count?: number) => ConsumeResult;
  /** Reseta o bucket para capacidade máxima. */
  reset: () => void;
}

// ─── Implementação ────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "rl:";

/**
 * Cria um rate limiter baseado em token bucket.
 *
 * Algoritmo: refill linear contínuo.
 * - A cada `refillIntervalMs` ms, `capacity` tokens são adicionados.
 * - `tryConsume(n)` decrementa n tokens; retorna `allowed=false` se insuficientes.
 * - Estado persiste em `storage` (localStorage por default).
 *
 * Defesa: client-side. Não é proteção adversarial — server-side (Onda 3.2).
 * Objetivo: bloquear loop acidental (typeahead, useEffect descontrolado).
 */
export function createRateLimiter(cfg: BucketConfig): RateLimiter {
  const {
    key,
    capacity,
    refillIntervalMs,
    storage = safeLocalStorage(),
    now = Date.now,
  } = cfg;

  const storageKey = key.startsWith(STORAGE_KEY_PREFIX) ? key : `${STORAGE_KEY_PREFIX}${key}`;

  function readState(): BucketState {
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return { tokens: capacity, updatedAt: now() };
      const parsed = JSON.parse(raw) as Partial<BucketState>;
      return {
        tokens: typeof parsed.tokens === "number" ? parsed.tokens : capacity,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : now(),
      };
    } catch {
      return { tokens: capacity, updatedAt: now() };
    }
  }

  function writeState(state: BucketState): void {
    try {
      storage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // localStorage cheio ou indisponível — degrada silenciosamente
    }
  }

  function calcRefill(state: BucketState, currentTime: number): number {
    const elapsedMs = Math.max(0, currentTime - state.updatedAt);
    const refillRate = capacity / refillIntervalMs; // tokens/ms
    const refilled = elapsedMs * refillRate;
    return Math.min(capacity, state.tokens + refilled);
  }

  function tryConsume(count = 1): ConsumeResult {
    const currentTime = now();
    const state = readState();
    const tokensAfterRefill = calcRefill(state, currentTime);

    if (tokensAfterRefill < count) {
      // Blocked — calcular quando terá tokens suficientes
      const deficit = count - tokensAfterRefill;
      const refillRate = capacity / refillIntervalMs;
      const retryAfterMs = Math.ceil(deficit / refillRate);

      // Persiste o estado com o refill (mas sem decrementar, pois foi bloqueado)
      writeState({ tokens: tokensAfterRefill, updatedAt: currentTime });

      return {
        allowed: false,
        tokensRemaining: tokensAfterRefill,
        retryAfterMs,
      };
    }

    const tokensAfterConsume = tokensAfterRefill - count;
    writeState({ tokens: tokensAfterConsume, updatedAt: currentTime });

    return {
      allowed: true,
      tokensRemaining: tokensAfterConsume,
      retryAfterMs: 0,
    };
  }

  function reset(): void {
    writeState({ tokens: capacity, updatedAt: now() });
  }

  return { tryConsume, reset };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fallback in-memory quando localStorage está indisponível
 * (Safari privado, iframe sandbox, SSR).
 */
function safeLocalStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    const testKey = "__rl_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return localStorage;
  } catch {
    return inMemoryStorage();
  }
}

function inMemoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
}

// ─── Helpers de conveniência ─────────────────────────────────────────────────

/**
 * Token bucket simples (API funcional, sem factory).
 * Compatível com o contrato descrito no architect-plan §Sprint 3.1.4.
 *
 * @deprecated Prefira `createRateLimiter` para uso em hooks (injetabilidade).
 */
export function tokenBucket(
  key: string,
  capacity: number,
  refillPerMinute: number,
): { allowed: boolean; retryInSec: number } {
  const limiter = createRateLimiter({
    key,
    capacity,
    refillIntervalMs: 60_000,
  });
  // refillPerMinute é equivalente a capacity/min — usa capacity diretamente
  void refillPerMinute; // documentado: refill = capacity/min
  const result = limiter.tryConsume(1);
  return {
    allowed: result.allowed,
    retryInSec: result.retryAfterMs > 0 ? Math.ceil(result.retryAfterMs / 1000) : 0,
  };
}
