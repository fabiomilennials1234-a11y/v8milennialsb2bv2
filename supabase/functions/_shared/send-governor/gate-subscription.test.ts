/**
 * O choke de envio respeita a assinatura da org.
 *
 * `governSend` é por onde passam TODOS os envios de WhatsApp do backend —
 * helpers do whatsapp-dispatch, copilot-v2-worker, dispatch-router,
 * followup-sender, outbound-sender. É o único ponto onde dá para desligar o
 * motor de uma org suspensa, porque o backend roda como service_role e a RLS
 * não o alcança.
 *
 * O que estes testes travam:
 *   - org bloqueada NÃO envia, e nem chega a consultar o governor;
 *   - inclusive na categoria 'manual', que é isenta de reputação mas não de
 *     cobrança;
 *   - org ativa envia normalmente (controle positivo — sem ele, um bug que
 *     bloqueia tudo passaria verde).
 */

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@^1.0.0";
import { governSend, isSkippedSend } from "./gate.ts";
import { __resetOrgStatusCache } from "../org-status.ts";
import type { GovernSendDeps } from "./gate.ts";

const ORG = "33333333-3333-3333-3333-333333333333";

function supabaseComBloqueio(blocked: boolean) {
  return {
    rpc(fn: string) {
      if (fn === "org_access_blocked") return Promise.resolve({ data: blocked });
      return Promise.resolve({ data: null });
    },
    from() {
      throw new Error("governor não deveria tocar o banco neste teste");
    },
  };
}

/** Deps que explodem se forem tocadas — provam que o gate corta ANTES do governor. */
const depsQueExplodem = {
  resolveGovernorState: () => {
    throw new Error("resolveGovernorState não deveria rodar");
  },
  evaluateSend: () => {
    throw new Error("evaluateSend não deveria rodar");
  },
  recordDecision: () => {
    throw new Error("recordDecision não deveria rodar");
  },
  incrementAutomationUsage: () => {
    throw new Error("incrementAutomationUsage não deveria rodar");
  },
  recordBanSignal: () => {
    throw new Error("recordBanSignal não deveria rodar");
  },
} as unknown as GovernSendDeps;

const depsPermissivas = {
  resolveGovernorState: () => Promise.resolve({ mode: "off" }),
  evaluateSend: () => ({
    action: "allow",
    wouldBe: "allow",
    reason: "governor_off",
    category: "automation",
    mode: "off",
    shadowed: false,
  }),
  recordDecision: () => Promise.resolve(),
  incrementAutomationUsage: () => Promise.resolve(),
  recordBanSignal: () => Promise.resolve(),
} as unknown as GovernSendDeps;

Deno.test("org bloqueada — o envio não acontece", async () => {
  __resetOrgStatusCache();
  let enviou = false;

  const res = await governSend(
    // deno-lint-ignore no-explicit-any
    supabaseComBloqueio(true) as any,
    { orgId: ORG, category: "automation", recipientPhone: "5511999999999" },
    () => {
      enviou = true;
      return Promise.resolve("enviado");
    },
    depsQueExplodem,
  );

  assertFalse(enviou, "doSend rodou numa org com assinatura bloqueada");
  assert(isSkippedSend(res));
  assertEquals((res as { action: string }).action, "block");
  assertEquals((res as { reason: string }).reason, "subscription_blocked");
});

Deno.test("org bloqueada — nem a categoria 'manual' escapa", async () => {
  __resetOrgStatusCache();
  let enviou = false;

  const res = await governSend(
    // deno-lint-ignore no-explicit-any
    supabaseComBloqueio(true) as any,
    { orgId: ORG, category: "manual", recipientPhone: "5511999999999" },
    () => {
      enviou = true;
      return Promise.resolve("enviado");
    },
    depsQueExplodem,
  );

  assertFalse(enviou, "'manual' é isenta de reputação, não de cobrança");
  assert(isSkippedSend(res));
});

Deno.test("controle positivo — org ativa envia", async () => {
  __resetOrgStatusCache();
  let enviou = false;

  const res = await governSend(
    // deno-lint-ignore no-explicit-any
    supabaseComBloqueio(false) as any,
    { orgId: ORG, category: "automation", recipientPhone: "5511999999999" },
    () => {
      enviou = true;
      return Promise.resolve("enviado");
    },
    depsPermissivas,
  );

  assert(enviou, "org ativa parou de enviar — o gate está bloqueando demais");
  assertFalse(isSkippedSend(res));
  assertEquals(res, "enviado");
});
