/**
 * A chave pública da Stripe no navegador. Só `pk_test_`/`pk_live_`: qualquer outra coisa
 * (ausente, `sk_` por engano, `rk_`) é configuração quebrada e a tela não pede dado nenhum.
 *
 * `livemode` da resposta do POST é comparado com esta chave. Divergiu, não monta Elements:
 * chave de teste com segredo de produção (ou o inverso) falharia dentro do iframe.
 */
export type PublishableKey =
  | { ok: true; key: string; livemode: boolean }
  | { ok: false };

export function parsePublishableKey(raw: unknown): PublishableKey {
  if (typeof raw !== "string") return { ok: false };
  const key = raw.trim();
  const match = /^pk_(test|live)_[A-Za-z0-9]+$/.exec(key);
  if (!match) return { ok: false };
  return { ok: true, key, livemode: match[1] === "live" };
}

export function readPublishableKey(): PublishableKey {
  return parsePublishableKey(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
}

export function keyMatchesLivemode(key: PublishableKey, livemode: boolean): boolean {
  return key.ok && key.livemode === livemode;
}
