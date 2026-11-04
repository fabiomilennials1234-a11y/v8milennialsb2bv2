/**
 * Cliente com Service Worker antigo. O SW velho intercepta o script da Stripe e o bloqueia (ver
 * `shared/pwa/asset-routing.ts`), e ele continua no controle mesmo depois do deploy: o novo fica
 * esperando até o usuário aceitar a atualização. Quem abre o link nessa janela não pagaria.
 *
 * Aqui a atualização alcança o cliente: pergunta ao controller se é da versão que deixa a Stripe
 * passar; se não responder, pede update e ativa o que estiver esperando. O `clientsClaim` do SW
 * novo assume a página sem recarregar, então nada do que foi digitado se perde. Nunca desregistra:
 * isso derrubaria a assinatura de push de quem já usa o app.
 *
 * Sem atualização disponível, devolve "stale" e a tela segue: o Stripe.js falha, aparece o aviso, e
 * "Tentar de novo" passa por aqui outra vez.
 */
import { STRIPE_BYPASS_PROBE } from "@/shared/pwa/asset-routing";

const PROBE_TIMEOUT_MS = 400;
const POLL_MS = 200;
const DEFAULT_TIMEOUT_MS = 15_000;

export type StripeReachability = "no_controller" | "safe" | "updated" | "stale";

function probe(controller: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (answer: boolean) => {
      window.clearTimeout(timer);
      channel.port1.close();
      resolve(answer);
    };
    const timer = window.setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    channel.port1.onmessage = (event) => finish(event.data?.ok === true);
    try {
      controller.postMessage({ type: STRIPE_BYPASS_PROBE }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export async function ensureStripeReachable({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}): Promise<StripeReachability> {
  const container = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!container?.controller) return "no_controller";
  // Duas chances: SW novo ocupado instalando ou acordando pode perder 400 ms, e isso não é motivo
  // para sair ativando versão.
  if ((await probe(container.controller)) || (await probe(container.controller))) return "safe";

  const deadline = Date.now() + timeoutMs;
  try {
    const registration = await container.getRegistration();
    if (!registration) return "stale";
    await registration.update().catch(() => undefined);

    while (!registration.waiting && Date.now() < deadline) await wait(POLL_MS);
    if (!registration.waiting) return "stale";

    const taken = new Promise<void>((resolve) => {
      const onChange = () => {
        container.removeEventListener("controllerchange", onChange);
        resolve();
      };
      container.addEventListener("controllerchange", onChange);
    });
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    await Promise.race([taken, wait(Math.max(deadline - Date.now(), POLL_MS))]);

    const current = container.controller;
    return current && (await probe(current)) ? "updated" : "stale";
  } catch {
    return "stale";
  }
}
