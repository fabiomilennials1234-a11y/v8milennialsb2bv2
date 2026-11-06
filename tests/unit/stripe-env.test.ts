// @vitest-environment node
/**
 * Critério 11: chave e STRIPE_ENV divergentes não falam com a Stripe. A leitura é
 * pura de propósito: a edge function decide 503 antes de instanciar o cliente.
 */
import { describe, it, expect } from "vitest";
import { readStripeConfig } from "../../supabase/functions/_shared/stripe/env.ts";

const env = (m: Record<string, string>) => (k: string) => m[k];
const TEST_KEY = ["sk", "test", "abc"].join("_");
const LIVE_KEY = ["sk", "live", "abc"].join("_");

describe("readStripeConfig", () => {
  it("aceita test + sk_test_ e rk_test_", () => {
    const r = readStripeConfig(env({ STRIPE_ENV: "test", STRIPE_SECRET_KEY: TEST_KEY }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config).toMatchObject({ env: "test", livemode: false, webhookSecret: null });
    expect(readStripeConfig(env({ STRIPE_ENV: "test", STRIPE_SECRET_KEY: ["rk", "test", "x"].join("_") })).ok).toBe(true);
  });

  it("aceita live + sk_live_ e devolve livemode", () => {
    const r = readStripeConfig(env({ STRIPE_ENV: "live", STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: "w" }));
    expect(r.ok && r.config.livemode).toBe(true);
    expect(r.ok && r.config.webhookSecret).toBe("w");
  });

  it.each([
    ["ausente", {}],
    ["env vazio", { STRIPE_ENV: "", STRIPE_SECRET_KEY: TEST_KEY }],
    ["env com outro valor", { STRIPE_ENV: "sandbox", STRIPE_SECRET_KEY: TEST_KEY }],
    ["env com espaço não vira test", { STRIPE_ENV: " test", STRIPE_SECRET_KEY: TEST_KEY }],
    ["env com caixa diferente", { STRIPE_ENV: "TEST", STRIPE_SECRET_KEY: TEST_KEY }],
    ["chave ausente", { STRIPE_ENV: "test" }],
    ["test com chave live", { STRIPE_ENV: "test", STRIPE_SECRET_KEY: LIVE_KEY }],
    ["live com chave test", { STRIPE_ENV: "live", STRIPE_SECRET_KEY: TEST_KEY }],
    ["chave publicável", { STRIPE_ENV: "test", STRIPE_SECRET_KEY: ["pk", "test", "x"].join("_") }],
  ])("falha fechada: %s", (_nome, m) => {
    const r = readStripeConfig(env(m as Record<string, string>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("billing_not_configured");
  });

  it("o motivo interno nunca carrega a chave", () => {
    const r = readStripeConfig(env({ STRIPE_ENV: "test", STRIPE_SECRET_KEY: LIVE_KEY }));
    expect(JSON.stringify(r)).not.toContain(LIVE_KEY);
  });
});
