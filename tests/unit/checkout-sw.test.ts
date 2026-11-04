/**
 * O Service Worker não pode tocar no que é da Stripe. `fetch` dentro do SW obedece ao connect-src
 * do /sw.js, sem js.stripe.com: interceptar o script era o mesmo que bloqueá-lo, em toda volta
 * ao link. Abrir a CSP faria o SW guardar Stripe.js em cache, que é pior.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STRIPE_BYPASS_PROBE, isAppOwnedRequest } from "@/shared/pwa/runtime-routes";
import { ensureStripeReachable } from "@/modules/billing/lib/checkout-sw";

const self = "https://torquecrm.com.br";
const owned = (href: string) => isAppOwnedRequest(new URL(href), self);

describe("cache de runtime do SW e a Stripe", () => {
  it.each([
    "https://js.stripe.com/clover/stripe.js",
    "https://x.js.stripe.com/fingerprinted/css/a.css",
    "https://api.stripe.com/v1/tokens",
    "https://hooks.stripe.com/3d_secure/x",
    "https://b.stripecdn.com/x.woff2",
    "https://q.stripe.com/pixel.png",
  ])("não toca em %s", (href) => {
    expect(owned(href)).toBe(false);
  });

  it("host que imita a Stripe sob a nossa origem continua sendo nosso, e a Stripe sob o nosso nome não", () => {
    expect(owned("https://torquecrm.com.br/assets/js.stripe.com.js")).toBe(true);
    expect(owned("https://torquecrm.com.br.js.stripe.com/a.js")).toBe(false);
  });

  it("continua cacheando os ativos da própria aplicação", () => {
    expect(owned("https://torquecrm.com.br/assets/a.js")).toBe(true);
  });
});

describe("src/sw.ts", () => {
  const sw = readFileSync(resolve(__dirname, "../../src/sw.ts"), "utf8");
  it("nenhuma rota casa por destino sem passar pela guarda, e o SW responde à sonda", () => {
    expect(sw).not.toContain("({ request }) => request.destination");
    expect(sw.match(/isAppOwnedRequest\(/g)?.length).toBe(2);
    expect(sw).toContain("STRIPE_BYPASS_PROBE");
  });

  it("as outras rotas de runtime são só do Supabase: nenhuma alcança a Stripe", () => {
    const rotasPorUrl = [...sw.matchAll(/\(\{ url \}\) => (.+)\.test\(url\.href\)/g)].map((m) => m[1]!);
    expect(rotasPorUrl.length).toBeGreaterThan(0);
    for (const rota of rotasPorUrl) expect(rota).toContain("supabase");
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
