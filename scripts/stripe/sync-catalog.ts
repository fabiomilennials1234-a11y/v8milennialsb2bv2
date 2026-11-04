/**
 * Sincroniza o catálogo da Stripe com `_shared/stripe/catalog.ts`.
 *
 *   STRIPE_SECRET_KEY=... deno run --no-lock --allow-env=STRIPE_SECRET_KEY \
 *     --allow-net=api.stripe.com scripts/stripe/sync-catalog.ts [--apply] [--live]
 *
 * Sem --apply é dry-run. Chave live é recusada sem --live. Idempotente: a segunda
 * execução não tem o que fazer. Nunca imprime a chave.
 */

// `Deno.exit` e `Deno.env` só existem no runtime deste script.
declare const Deno: {
  args: string[];
  env: { get(name: string): string | undefined };
  exit(code: number): never;
};

import { createStripeSdk } from "../../supabase/functions/_shared/stripe/client.ts";
import {
  catalogProducts,
  planCatalogSync,
  type CatalogOp,
  type RemotePrice,
  type RemoteProduct,
} from "../../supabase/functions/_shared/stripe/catalog.ts";

const apply = Deno.args.includes("--apply");
const allowLive = Deno.args.includes("--live");

const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
if (!/^(sk|rk)_(test|live)_/.test(key)) {
  console.error("STRIPE_SECRET_KEY ausente ou com formato inesperado.");
  Deno.exit(2);
}
const live = /^(sk|rk)_live_/.test(key);
if (live && !allowLive) {
  console.error("Recusado: chave live sem --live.");
  Deno.exit(2);
}

const stripe = createStripeSdk(key);

const products: RemoteProduct[] = [];
for (const { id } of catalogProducts()) {
  try {
    const p = await stripe.products.retrieve(id);
    products.push({ id: p.id, name: p.name, active: p.active });
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode !== 404) throw err;
  }
}

const prices: RemotePrice[] = [];
for await (const p of stripe.prices.list({ active: true, limit: 100 })) {
  if (!p.lookup_key?.startsWith("torque_")) continue;
  prices.push({
    id: p.id,
    lookup_key: p.lookup_key,
    product: typeof p.product === "string" ? p.product : p.product.id,
    unit_amount: p.unit_amount,
    currency: p.currency,
    tax_behavior: p.tax_behavior,
    active: p.active,
    recurring: p.recurring
      ? { interval: p.recurring.interval, interval_count: p.recurring.interval_count }
      : null,
  });
}

const ops = planCatalogSync({ products, prices });
const rotulo = (op: CatalogOp) => {
  switch (op.kind) {
    case "create_product": return `create_product ${op.product.id}`;
    case "activate_product": return `activate_product ${op.product_id}`;
    case "create_price": return `create_price ${op.price.lookup_key} ${op.price.unit_amount}${op.transfer_lookup_key ? " (transfer)" : ""}`;
    case "archive_price": return `archive_price ${op.price_id}`;
  }
};

console.log(`modo=${live ? "live" : "test"} ${apply ? "apply" : "dry-run"} mudanças=${ops.length}`);
for (const op of ops) console.log(rotulo(op));

if (apply) {
  for (const op of ops) {
    switch (op.kind) {
      case "create_product":
        await stripe.products.create({ id: op.product.id, name: op.product.name, metadata: op.product.metadata });
        break;
      case "activate_product":
        await stripe.products.update(op.product_id, { active: true });
        break;
      case "create_price":
        await stripe.prices.create({
          product: op.price.product,
          unit_amount: op.price.unit_amount,
          currency: op.price.currency,
          tax_behavior: op.price.tax_behavior,
          recurring: op.price.recurring,
          lookup_key: op.price.lookup_key,
          transfer_lookup_key: op.transfer_lookup_key,
          metadata: op.price.metadata,
        });
        break;
      case "archive_price":
        await stripe.prices.update(op.price_id, { active: false });
        break;
    }
  }
  console.log("aplicado");
}
