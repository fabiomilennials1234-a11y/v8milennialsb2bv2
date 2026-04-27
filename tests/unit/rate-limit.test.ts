/**
 * Testes unitários para src/lib/rate-limit.ts
 *
 * Onda 3.1, C23. Cobre: allow até capacity, block ao esgotar,
 * refill linear, reset manual, clock skew, storage fallback,
 * conta múltiplos tokens, isolamento de chaves.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createRateLimiter, tokenBucket } from "@/lib/rate-limit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    _store: store,
  };
}

function makeClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => { current += ms; },
    set: (ms: number) => { current = ms; },
  };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("createRateLimiter", () => {
  describe("allow até capacity", () => {
    it("permite exatamente capacity=5 requisições", () => {
      const storage = makeStorage();
      const clock = makeClock(1_000);
      const limiter = createRateLimiter({ key: "rl:test:user1", capacity: 5, refillIntervalMs: 60_000, storage, now: clock.now });

      for (let i = 0; i < 5; i++) {
        const result = limiter.tryConsume();
        expect(result.allowed).toBe(true);
        expect(result.retryAfterMs).toBe(0);
      }
    });

    it("retorna tokensRemaining decrementando", () => {
      const storage = makeStorage();
      const clock = makeClock(1_000);
      const limiter = createRateLimiter({ key: "rl:test:user2", capacity: 3, refillIntervalMs: 60_000, storage, now: clock.now });

      expect(limiter.tryConsume().tokensRemaining).toBeCloseTo(2, 0);
      expect(limiter.tryConsume().tokensRemaining).toBeCloseTo(1, 0);
      expect(limiter.tryConsume().tokensRemaining).toBeCloseTo(0, 0);
    });
  });

  describe("block ao esgotar", () => {
    it("bloqueia na requisição N+1 após esgotar capacity=3", () => {
      const storage = makeStorage();
      const clock = makeClock(1_000);
      const limiter = createRateLimiter({ key: "rl:test:user3", capacity: 3, refillIntervalMs: 60_000, storage, now: clock.now });

      limiter.tryConsume();
      limiter.tryConsume();
      limiter.tryConsume();

      const result = limiter.tryConsume();
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it("retryAfterMs é positivo quando bloqueado", () => {
      const storage = makeStorage();
      const clock = makeClock(1_000);
      const limiter = createRateLimiter({ key: "rl:test:user4", capacity: 1, refillIntervalMs: 60_000, storage, now: clock.now });

      limiter.tryConsume(); // usa o único token
      const blocked = limiter.tryConsume();
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
      expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
    });
  });

  describe("refill linear", () => {
    it("refill parcial após metade do intervalo", () => {
      const storage = makeStorage();
      const clock = makeClock(0);
      const limiter = createRateLimiter({ key: "rl:test:refill1", capacity: 10, refillIntervalMs: 60_000, storage, now: clock.now });

      // Esgota todos os tokens
      for (let i = 0; i < 10; i++) limiter.tryConsume();

      const blocked = limiter.tryConsume();
      expect(blocked.allowed).toBe(false);

      // Avança 30s = metade do intervalo → deve ter ~5 tokens
      clock.advance(30_000);
      const result = limiter.tryConsume();
      expect(result.allowed).toBe(true);
      // Após consumir 1, restam ~4
      expect(result.tokensRemaining).toBeCloseTo(4, 0);
    });

    it("refill completo após 1 intervalo", () => {
      const storage = makeStorage();
      const clock = makeClock(0);
      const limiter = createRateLimiter({ key: "rl:test:refill2", capacity: 5, refillIntervalMs: 60_000, storage, now: clock.now });

      // Esgota
      for (let i = 0; i < 5; i++) limiter.tryConsume();
      expect(limiter.tryConsume().allowed).toBe(false);

      // Avança 1 min completo
      clock.advance(60_000);
      const result = limiter.tryConsume();
      expect(result.allowed).toBe(true);
      // Após refill completo (5) e consumir 1 → 4
      expect(result.tokensRemaining).toBeCloseTo(4, 0);
    });

    it("cap no capacity mesmo após múltiplos intervalos", () => {
      const storage = makeStorage();
      const clock = makeClock(0);
      const limiter = createRateLimiter({ key: "rl:test:refill3", capacity: 5, refillIntervalMs: 60_000, storage, now: clock.now });

      // Avança 10 minutos sem nenhuma requisição
      clock.advance(600_000);
      const result = limiter.tryConsume();
      expect(result.allowed).toBe(true);
      // Deve ter no máx capacity-1 restantes (não acumula além de capacity)
      expect(result.tokensRemaining).toBeCloseTo(4, 0);
    });
  });

  describe("reset manual", () => {
    it("reset restaura capacity máximo", () => {
      const storage = makeStorage();
      const clock = makeClock(1_000);
      const limiter = createRateLimiter({ key: "rl:test:reset1", capacity: 5, refillIntervalMs: 60_000, storage, now: clock.now });

      // Esgota
      for (let i = 0; i < 5; i++) limiter.tryConsume();
      expect(limiter.tryConsume().allowed).toBe(false);

      // Reset
      limiter.reset();
      const result = limiter.tryConsume();
      expect(result.allowed).toBe(true);
      expect(result.tokensRemaining).toBeCloseTo(4, 0);
    });
  });

  describe("isolamento de chaves", () => {
    it("chaves diferentes têm buckets independentes", () => {
      const storage = makeStorage();
      const clock = makeClock(1_000);

      const limiterA = createRateLimiter({ key: "rl:test:userA", capacity: 1, refillIntervalMs: 60_000, storage, now: clock.now });
      const limiterB = createRateLimiter({ key: "rl:test:userB", capacity: 1, refillIntervalMs: 60_000, storage, now: clock.now });

      limiterA.tryConsume(); // esgota A
      expect(limiterA.tryConsume().allowed).toBe(false);
      expect(limiterB.tryConsume().allowed).toBe(true); // B não foi afetado
    });
  });

  describe("consume múltiplos tokens", () => {
    it("tryConsume(3) remove 3 tokens de uma vez", () => {
      const storage = makeStorage();
      const clock = makeClock(1_000);
      const limiter = createRateLimiter({ key: "rl:test:multi1", capacity: 5, refillIntervalMs: 60_000, storage, now: clock.now });

      const result = limiter.tryConsume(3);
      expect(result.allowed).toBe(true);
      expect(result.tokensRemaining).toBeCloseTo(2, 0);
    });

    it("tryConsume(N) bloqueado se N > tokens disponíveis", () => {
      const storage = makeStorage();
      const clock = makeClock(1_000);
      const limiter = createRateLimiter({ key: "rl:test:multi2", capacity: 2, refillIntervalMs: 60_000, storage, now: clock.now });

      const result = limiter.tryConsume(3);
      expect(result.allowed).toBe(false);
    });
  });

  describe("storage fallback", () => {
    it("opera corretamente com storage in-memory customizado", () => {
      const storage = makeStorage();
      const clock = makeClock(0);
      const limiter = createRateLimiter({ key: "rl:test:mem", capacity: 3, refillIntervalMs: 60_000, storage, now: clock.now });

      expect(limiter.tryConsume().allowed).toBe(true);
      expect(limiter.tryConsume().allowed).toBe(true);
      expect(limiter.tryConsume().allowed).toBe(true);
      expect(limiter.tryConsume().allowed).toBe(false);

      // Verifica que o estado foi persistido no storage
      // key começa com "rl:" → não duplica o prefixo → chave final é "rl:test:mem"
      expect(storage._store.has("rl:test:mem")).toBe(true);
    });

    it("inicia com capacity completo quando storage vazio", () => {
      const storage = makeStorage();
      const clock = makeClock(1_000);
      const limiter = createRateLimiter({ key: "rl:fresh", capacity: 10, refillIntervalMs: 60_000, storage, now: clock.now });

      const result = limiter.tryConsume();
      expect(result.allowed).toBe(true);
      expect(result.tokensRemaining).toBeCloseTo(9, 0);
    });
  });
});

describe("tokenBucket (compat API)", () => {
  it("permite até capacity e bloqueia no seguinte", () => {
    // Nota: tokenBucket usa localStorage real — limpar antes
    const key = `__test_tb_${Math.random()}`;

    for (let i = 0; i < 20; i++) {
      const r = tokenBucket(key, 20, 20);
      expect(r.allowed).toBe(true);
    }

    const blocked = tokenBucket(key, 20, 20);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryInSec).toBeGreaterThan(0);
  });
});
