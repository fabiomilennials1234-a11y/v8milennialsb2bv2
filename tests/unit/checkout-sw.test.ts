/**
 * O Service Worker não pode tocar no que é da Stripe. `fetch` dentro do SW obedece ao connect-src
 * do /sw.js, sem js.stripe.com: interceptar o script era o mesmo que bloqueá-lo, em toda volta
 * ao link. Abrir a CSP faria o SW guardar Stripe.js em cache, que é pior.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import headers from "../../cloudflare/headers.json";
import { STRIPE_BYPASS_PROBE, shouldCacheAsset } from "@/shared/pwa/asset-routing";
import { ensureStripeReachable } from "@/modules/billing/lib/checkout-sw";

const self = "https://torquecrm.com.br";
const at = (href: string, destination: string) => ({ url: new URL(href), destination, selfOrigin: self });

describe("shouldCacheAsset", () => {
  it.each([
    ["https://js.stripe.com/clover/stripe.js", "script"],
    ["https://js.stripe.com/x/fingerprinted/css/a.css", "style"],
    ["https://b.stripecdn.com/x.woff2", "font"],
    ["https://q.stripe.com/pixel.png", "image"],
    ["https://cdnjs.cloudflare.com/a.css", "style"],
    ["https://exemplo.com/foto.png", "image"],
  ])("não toca em %s", (href, destination) => {
    expect(shouldCacheAsset(at(href, destination))).toBe(false);
  });

  it.each([
    ["https://torquecrm.com.br/assets/a.js", "script"],
    ["https://torquecrm.com.br/assets/a.css", "style"],
    ["https://torquecrm.com.br/a.woff2", "font"],
    ["https://torquecrm.com.br/a.png", "image"],
    ["https://abc.supabase.co/storage/v1/object/public/x.png", "image"],
    ["https://fonts.googleapis.com/css2?family=X", "style"],
  ])("continua cacheando %s", (href, destination) => {
    expect(shouldCacheAsset(at(href, destination))).toBe(true);
  });

  it("nada fora de script, estilo, fonte e imagem", () => {
    expect(shouldCacheAsset(at("https://torquecrm.com.br/a", "document"))).toBe(false);
    expect(shouldCacheAsset(at("https://torquecrm.com.br/a", ""))).toBe(false);
  });

  it("todo host externo aceito está no connect-src: fora dele o fetch do SW nunca funcionou", () => {
    const connect = /connect-src ([^;]+);/.exec(headers.profiles.app["Content-Security-Policy"])![1]!;
    expect(connect).toContain("https://*.supabase.co");
    expect(connect).toContain("https://fonts.googleapis.com");
  });
});

describe("src/sw.ts", () => {
  const sw = readFileSync(resolve(__dirname, "../../src/sw.ts"), "utf8");
  it("as duas rotas de ativo passam pelo filtro, e o SW responde à sonda", () => {
    expect(sw).not.toContain("({ request }) => request.destination === 'script'");
    expect(sw.match(/shouldCacheAsset\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sw).toContain("STRIPE_BYPASS_PROBE");
  });
});

describe("ensureStripeReachable: cliente com SW antigo", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Controller que responde (ou não) à sonda, com MessageChannel de verdade. */
  const controller = (answers: boolean) => ({
    postMessage: (msg: { type: string }, ports?: MessagePort[]) => {
      if (answers && msg.type === STRIPE_BYPASS_PROBE) ports?.[0]?.postMessage({ type: STRIPE_BYPASS_PROBE, ok: true });
    },
  });

  it("sem controller: nada a fazer", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
    await expect(ensureStripeReachable({ timeoutMs: 50 })).resolves.toBe("no_controller");
  });

  it("SW novo: responde à sonda e nada muda", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: controller(true) } });
    await expect(ensureStripeReachable({ timeoutMs: 50 })).resolves.toBe("safe");
  });

  it("SW novo ocupado perde a primeira sonda: a segunda basta, sem procurar atualização", async () => {
    let calls = 0;
    const update = vi.fn(async () => undefined);
    const sw = {
      controller: {
        postMessage: (msg: { type: string }, ports?: MessagePort[]) => {
          calls += 1;
          if (calls >= 2 && msg.type === STRIPE_BYPASS_PROBE) ports?.[0]?.postMessage({ type: STRIPE_BYPASS_PROBE, ok: true });
        },
      },
      getRegistration: async () => ({ update, waiting: null, installing: null }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("navigator", { serviceWorker: sw });
    await expect(ensureStripeReachable({ timeoutMs: 50 })).resolves.toBe("safe");
    expect(update).not.toHaveBeenCalled();
  });

  it("SW antigo: pede update e ativa o que estiver esperando", async () => {
    const waiting = { postMessage: vi.fn() };
    const listeners: Record<string, () => void> = {};
    const sw = {
      controller: controller(false),
      getRegistration: async () => ({ update: vi.fn(async () => undefined), waiting, installing: null }),
      addEventListener: (name: string, fn: () => void) => { listeners[name] = fn; },
      removeEventListener: vi.fn(),
    };
    waiting.postMessage.mockImplementation(() => {
      sw.controller = controller(true);
      listeners.controllerchange?.();
    });
    vi.stubGlobal("navigator", { serviceWorker: sw });
    await expect(ensureStripeReachable({ timeoutMs: 200 })).resolves.toBe("updated");
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("SW antigo sem atualização disponível: não trava a tela, devolve stale", async () => {
    const sw = {
      controller: controller(false),
      getRegistration: async () => ({ update: async () => undefined, waiting: null, installing: null }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("navigator", { serviceWorker: sw });
    await expect(ensureStripeReachable({ timeoutMs: 100 })).resolves.toBe("stale");
  });
});
