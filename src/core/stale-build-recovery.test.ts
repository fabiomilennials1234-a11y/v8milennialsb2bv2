import { describe, expect, it, vi } from "vitest";
import {
  RECOVERY_THROTTLE_MS,
  isStaleAssetLoadError,
  isStaleChunkError,
  missingStylesheets,
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
    canReload: async () => true,
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
  it("preserva cache e SW se o servidor estiver indisponível, inclusive no retry manual", async () => {
    const { env, log } = fakeEnv();
    env.canReload = async () => false;
    expect(await recoverFromStaleBuild(env)).toBe(false);
    expect(await recoverFromStaleBuild(env, { force: true })).toBe(false);
    expect(log).toEqual([]);
  });

  it("recupera assim que o servidor volta sem consumir o throttle na falha", async () => {
    const { env, log } = fakeEnv();
    env.canReload = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await recoverFromStaleBuild(env)).toBe(false);
    expect(await recoverFromStaleBuild(env)).toBe(true);
    expect(log.filter((item) => item === "reload")).toHaveLength(1);
  });
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
    "Unable to preload CSS for /assets/Dashboard-abc123.css",
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

// Chamado 39ff2cd1, print das 18:39 UTC: o JS do app rodou (sidebar visível),
// mas o CSS do build não aplicou e a rota não montou. Falha de <link> não vira
// erro de JS — só aparece como evento de recurso (fase de captura) ou como
// `link.sheet === null`.
describe("isStaleAssetLoadError", () => {
  function failedResource(el: Element): Event {
    const ev = new Event("error");
    Object.defineProperty(ev, "target", { value: el });
    return ev;
  }

  it("reconhece stylesheet do build que falhou ao carregar", () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/index-abc123.css";
    expect(isStaleAssetLoadError(failedResource(link))).toBe(true);
  });

  it("reconhece script do build que falhou ao carregar", () => {
    const script = document.createElement("script");
    script.src = "/assets/Leads-abc123.js";
    expect(isStaleAssetLoadError(failedResource(script))).toBe(true);
  });

  it("ignora recurso de fora do build (fonte, imagem de terceiro)", () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter";
    expect(isStaleAssetLoadError(failedResource(link))).toBe(false);
    const img = document.createElement("img");
    img.src = "/assets/logo-abc123.png";
    expect(isStaleAssetLoadError(failedResource(img))).toBe(false);
  });

  it("ignora erro de JS comum (target = window)", () => {
    expect(isStaleAssetLoadError(new ErrorEvent("error", { message: "boom" }))).toBe(false);
  });
});

describe("missingStylesheets", () => {
  function doc(links: Array<{ href: string; loaded: boolean }>): Document {
    const d = document.implementation.createHTMLDocument("t");
    const base = d.createElement("base");
    base.href = document.baseURI;
    d.head.appendChild(base);
    for (const l of links) {
      const el = d.createElement("link");
      el.rel = "stylesheet";
      el.href = l.href;
      Object.defineProperty(el, "sheet", { value: l.loaded ? {} : null });
      d.head.appendChild(el);
    }
    return d;
  }

  it("aponta o CSS do build que não carregou", () => {
    const d = doc([{ href: "/assets/index-abc123.css", loaded: false }]);
    expect(missingStylesheets(d)).toEqual([expect.stringContaining("/assets/index-abc123.css")]);
  });

  it("CSS carregado e stylesheet de terceiro não contam", () => {
    const d = doc([
      { href: "/assets/index-abc123.css", loaded: true },
      { href: "https://fonts.googleapis.com/css2?family=Inter", loaded: false },
    ]);
    expect(missingStylesheets(d)).toEqual([]);
  });
});
