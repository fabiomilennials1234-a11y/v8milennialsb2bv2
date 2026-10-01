import { describe, expect, it, vi } from "vitest";
import {
  RECOVERY_THROTTLE_MS,
  isStaleChunkError,
  lazyRetry,
  recoverFromStaleBuild,
  type RecoveryEnv,
} from "./stale-build-recovery";

/** Ambiente falso: relógio controlado, storage em memória e um log da ordem das ações. */
function fakeEnv(start = 1_000_000) {
  let clock = start;
  const store = new Map<string, string>();
  const log: string[] = [];
  const env: RecoveryEnv = {
    now: () => clock,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    },
    serviceWorker: {
      getRegistrations: async () => [
        { unregister: async () => (log.push("unregister"), true) },
      ],
    },
    caches: {
      keys: async () => ["workbox-precache-v2", "js-assets"],
      delete: async (k) => (log.push(`delete:${k}`), true),
    },
    reload: () => void log.push("reload"),
  };
  return { env, log, advance: (ms: number) => (clock += ms) };
}

const chunkError = new TypeError(
  "Failed to fetch dynamically imported module: https://torquecrm.com.br/assets/Leads-abc123.js",
);

describe("recoverFromStaleBuild", () => {
  it("(a) uma segunda falha na mesma aba, passada a janela, recupera de novo", async () => {
    const { env, log, advance } = fakeEnv();
    expect(await recoverFromStaleBuild(env)).toBe(true);
    advance(2 * 60_000);
    expect(await recoverFromStaleBuild(env)).toBe(true);
    expect(log.filter((l) => l === "reload")).toHaveLength(2);
  });

  it("(b) desregistra o service worker e limpa os caches ANTES do reload", async () => {
    const { env, log } = fakeEnv();
    await recoverFromStaleBuild(env);
    expect(log).toEqual([
      "unregister",
      "delete:workbox-precache-v2",
      "delete:js-assets",
      "reload",
    ]);
  });

  it("(c) duas falhas dentro da janela não recarregam em loop", async () => {
    const { env, log, advance } = fakeEnv();
    await recoverFromStaleBuild(env);
    advance(RECOVERY_THROTTLE_MS - 1);
    expect(await recoverFromStaleBuild(env)).toBe(false);
    expect(log.filter((l) => l === "reload")).toHaveLength(1);
  });

  it("o clique do usuário força a recuperação mesmo dentro da janela", async () => {
    const { env, log } = fakeEnv();
    await recoverFromStaleBuild(env);
    expect(await recoverFromStaleBuild(env, { force: true })).toBe(true);
    expect(log.filter((l) => l === "reload")).toHaveLength(2);
  });

  it("recarrega mesmo se a limpeza do service worker falhar", async () => {
    const { env, log } = fakeEnv();
    env.serviceWorker = {
      getRegistrations: async () => {
        throw new Error("SecurityError");
      },
    };
    await recoverFromStaleBuild(env);
    expect(log).toContain("reload");
  });

  it("storage inacessível (aba privada) não impede a recuperação", async () => {
    const { env, log } = fakeEnv();
    env.storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(await recoverFromStaleBuild(env)).toBe(true);
    expect(log).toContain("reload");
  });
});

describe("lazyRetry", () => {
  it("(d) esgotadas as tentativas de chunk velho, aciona a recuperação e repassa o erro", async () => {
    const { env, log } = fakeEnv();
    const importFn = vi.fn().mockRejectedValue(chunkError);
    await expect(lazyRetry(importFn, { retries: 1, delayMs: 0, env })).rejects.toBe(chunkError);
    expect(importFn).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(log).toContain("reload"));
  });

  it("uma falha passageira seguida de sucesso não recarrega", async () => {
    const { env, log } = fakeEnv();
    const mod = { default: () => null };
    const importFn = vi.fn().mockRejectedValueOnce(chunkError).mockResolvedValue(mod);
    await expect(lazyRetry(importFn, { retries: 1, delayMs: 0, env })).resolves.toBe(mod);
    expect(log).not.toContain("reload");
  });

  it("erro que não é de chunk não dispara recuperação", async () => {
    const { env, log } = fakeEnv();
    const boom = new Error("Cannot read properties of undefined");
    const importFn = vi.fn().mockRejectedValue(boom);
    await expect(lazyRetry(importFn, { retries: 0, delayMs: 0, env })).rejects.toBe(boom);
    expect(log).not.toContain("reload");
  });
});

describe("isStaleChunkError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://x/assets/a.js",
    "Importing a module script failed.",
    "Loading chunk 42 failed.",
    "Loading CSS chunk 7 failed",
    "Unexpected token '<'",
    "expected expression, got '<'",
  ])("reconhece %s", (message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it("reconhece ChunkLoadError pelo nome", () => {
    const e = new Error("x");
    e.name = "ChunkLoadError";
    expect(isStaleChunkError(e)).toBe(true);
  });

  it("não confunde erro de runtime com chunk velho", () => {
    expect(isStaleChunkError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});
