/**
 * Configuração da Stripe. Falha fechada: qualquer divergência entre STRIPE_ENV e o
 * prefixo da chave impede a função de instanciar o cliente. Sem isso, uma chave
 * live esquecida num ambiente "test" cobraria cartão de verdade.
 *
 * STRIPE_ENV é comparado sem trim e sem normalizar caixa: valor inesperado é
 * configuração errada, e configuração errada não vira palpite.
 */

export type StripeEnvName = "test" | "live";

export interface StripeConfig {
  env: StripeEnvName;
  secretKey: string;
  webhookSecret: string | null;
  livemode: boolean;
}

export type StripeConfigResult =
  | { ok: true; config: StripeConfig }
  | {
    ok: false;
    code: "billing_not_configured";
    reason: "env_invalid" | "key_missing" | "key_env_mismatch";
  };

export function readStripeConfig(get: (name: string) => string | undefined): StripeConfigResult {
  const env = get("STRIPE_ENV");
  if (env !== "test" && env !== "live") {
    return { ok: false, code: "billing_not_configured", reason: "env_invalid" };
  }

  const secretKey = get("STRIPE_SECRET_KEY") ?? "";
  if (!secretKey) return { ok: false, code: "billing_not_configured", reason: "key_missing" };

  const sufixo = `_${env}_`;
  const prefixoValido = secretKey.startsWith(`sk${sufixo}`) || secretKey.startsWith(`rk${sufixo}`);
  if (!prefixoValido) {
    return { ok: false, code: "billing_not_configured", reason: "key_env_mismatch" };
  }

  return {
    ok: true,
    config: {
      env,
      secretKey,
      webhookSecret: get("STRIPE_WEBHOOK_SECRET") || null,
      livemode: env === "live",
    },
  };
}
