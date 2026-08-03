import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1.0.0";
import { createAsaasProvider, mapAsaasStatus } from "./asaas-provider.ts";
import type { ChargeStatus } from "./types.ts";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Records every request and replies from a queue of canned responses.
 * A double that ignores what it was called with lets a broken payload pass.
 */
function stubFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: RecordedCall[] = [];
  const queue = [...responses];

  const fn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const next = queue.shift();
    if (!next) throw new Error(`stubFetch: unexpected extra call to ${url}`);

    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });

    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  return { fn, calls };
}

function provider(responses: Array<{ status?: number; body: unknown }>) {
  const stub = stubFetch(responses);
  return {
    calls: stub.calls,
    p: createAsaasProvider({
      apiUrl: "https://sandbox.example/v3",
      apiKey: "test-key-do-not-log",
      fetchImpl: stub.fn,
    }),
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

Deno.test("createAsaasProvider — fails fast when the api key is missing", () => {
  assertThrows(
    () => createAsaasProvider({ apiUrl: "https://x/v3", apiKey: "" }),
    Error,
    "ASAAS_API_KEY",
  );
});

// ---------------------------------------------------------------------------
// Status mapping — the webhook depends on this being total
// ---------------------------------------------------------------------------

Deno.test("mapAsaasStatus — maps every documented Asaas status to a canonical one", () => {
  const cases: Array<[string, ChargeStatus]> = [
    ["PENDING", "pending"],
    ["RECEIVED", "paid"],
    ["CONFIRMED", "paid"],
    ["RECEIVED_IN_CASH", "paid"],
    ["OVERDUE", "overdue"],
    ["DUNNING_REQUESTED", "overdue"],
    ["DUNNING_RECEIVED", "overdue"],
    ["REFUNDED", "refunded"],
    ["REFUND_REQUESTED", "refunded"],
    ["CHARGEBACK_REQUESTED", "chargeback"],
    ["CHARGEBACK_DISPUTE", "chargeback"],
    ["AWAITING_CHARGEBACK_REVERSAL", "chargeback"],
    ["AWAITING_RISK_ANALYSIS", "in_analysis"],
  ];
  for (const [asaas, canonical] of cases) {
    assertEquals(mapAsaasStatus(asaas), canonical, `${asaas} should map to ${canonical}`);
  }
});

Deno.test("mapAsaasStatus — an unknown status degrades instead of throwing", () => {
  // A webhook that throws on a status the gateway invented tomorrow is a webhook
  // that retries forever. Unknown must be representable.
  assertEquals(mapAsaasStatus("SOMETHING_NEW"), "unknown");
  assertEquals(mapAsaasStatus(""), "unknown");
});

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

Deno.test("ensureCustomer — reuses the existing customer instead of duplicating", async () => {
  const { p, calls } = provider([
    { body: { data: [{ id: "cus_1", name: "Fabrica X", email: "f@x.com", cpfCnpj: "123" }] } },
  ]);

  const customer = await p.ensureCustomer({
    name: "Fabrica X",
    email: "f@x.com",
    taxId: "12.345.678/0001-99",
  });

  assertEquals(customer.providerCustomerId, "cus_1");
  assertEquals(calls.length, 1, "should not POST when a customer already exists");
  assertEquals(calls[0].method, "GET");
});

Deno.test("ensureCustomer — creates when none exists, stripping tax id punctuation", async () => {
  const { p, calls } = provider([
    { body: { data: [] } },
    { body: { id: "cus_2", name: "Fabrica Y", email: "y@x.com", cpfCnpj: "12345678000199" } },
  ]);

  const customer = await p.ensureCustomer({
    name: "Fabrica Y",
    email: "y@x.com",
    taxId: "12.345.678/0001-99",
  });

  assertEquals(customer.providerCustomerId, "cus_2");
  assertEquals(calls[1].method, "POST");
  assertEquals((calls[1].body as Record<string, unknown>).cpfCnpj, "12345678000199");
});

Deno.test("ensureCustomer — looks the customer up by tax id, not by email", async () => {
  // Two organizations can share a billing email; the document is the identity.
  const { p, calls } = provider([{ body: { data: [{ id: "cus_3" }] } }]);
  await p.ensureCustomer({ name: "Z", email: "shared@x.com", taxId: "98765432000111" });
  assertEquals(calls[0].url.includes("cpfCnpj=98765432000111"), true);
});

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

Deno.test("createCharge — sends reais to the provider and returns cents", async () => {
  const { p, calls } = provider([
    {
      body: {
        id: "pay_1",
        customer: "cus_1",
        billingType: "PIX",
        value: 2189.6,
        dueDate: "2026-08-10",
        status: "PENDING",
      },
    },
  ]);

  const charge = await p.createCharge({
    providerCustomerId: "cus_1",
    method: "pix",
    amountCents: 218960,
    dueDate: "2026-08-10",
    description: "Torque Copilot — semestral",
  });

  assertEquals((calls[0].body as Record<string, unknown>).value, 2189.6);
  assertEquals((calls[0].body as Record<string, unknown>).billingType, "PIX");
  assertEquals(charge.amountCents, 218960);
  assertEquals(charge.status, "pending");
  assertEquals(charge.providerChargeId, "pay_1");
});

Deno.test("createCharge — a card charge carries a token, never raw card data", async () => {
  const { p, calls } = provider([
    { body: { id: "pay_2", customer: "cus_1", billingType: "CREDIT_CARD", value: 1997, status: "CONFIRMED" } },
  ]);

  await p.createCharge({
    providerCustomerId: "cus_1",
    method: "credit_card",
    amountCents: 199700,
    dueDate: "2026-08-10",
    description: "Torque Copilot",
    cardToken: "tok_abc",
  });

  const body = calls[0].body as Record<string, unknown>;
  assertEquals(body.creditCardToken, "tok_abc");
  // The port carries a token and only a token. Raw PAN, CVV and holder data must never be
  // constructible through this seam, whatever the surrounding integration shape turns out to be.
  assertEquals("creditCard" in body, false);
  assertEquals(JSON.stringify(body).includes("cardNumber"), false);
});

Deno.test("getCharge — maps a paid charge to the canonical shape", async () => {
  const { p } = provider([
    { body: { id: "pay_3", customer: "cus_9", billingType: "PIX", value: 3485, status: "RECEIVED" } },
  ]);
  const charge = await p.getCharge("pay_3");
  assertEquals(charge.status, "paid");
  assertEquals(charge.amountCents, 348500);
  assertEquals(charge.method, "pix");
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

Deno.test("createSubscription — maps canonical cycles to provider cycles", async () => {
  const { p, calls } = provider([
    { body: { id: "sub_1", customer: "cus_1", billingType: "CREDIT_CARD", value: 1997, cycle: "MONTHLY", status: "ACTIVE" } },
  ]);

  await p.createSubscription({
    providerCustomerId: "cus_1",
    method: "credit_card",
    cycle: "monthly",
    amountCents: 199700,
    nextDueDate: "2026-09-03",
    description: "Torque Copilot",
    cardToken: "tok_abc",
  });

  assertEquals((calls[0].body as Record<string, unknown>).cycle, "MONTHLY");
});

Deno.test("createSubscription — pix subscriptions are supported on long cycles", async () => {
  const { p, calls } = provider([
    { body: { id: "sub_2", customer: "cus_1", billingType: "PIX", value: 18711.9, cycle: "SEMIANNUALLY", status: "ACTIVE" } },
  ]);

  const sub = await p.createSubscription({
    providerCustomerId: "cus_1",
    method: "pix",
    cycle: "semiannual",
    amountCents: 1871190,
    nextDueDate: "2026-09-03",
    description: "Torque Automation — semestral",
  });

  const body = calls[0].body as Record<string, unknown>;
  assertEquals(body.billingType, "PIX");
  assertEquals(body.cycle, "SEMIANNUALLY");
  assertEquals(sub.cycle, "semiannual");
});

Deno.test("createSubscription — refuses pix on a monthly cycle before any network call", async () => {
  const { p, calls } = provider([]);
  await assertRejects(
    () =>
      p.createSubscription({
        providerCustomerId: "cus_1",
        method: "pix",
        cycle: "monthly",
        amountCents: 199700,
        nextDueDate: "2026-09-03",
        description: "nope",
      }),
    Error,
    "pix",
  );
  assertEquals(calls.length, 0, "policy must reject before touching the gateway");
});

Deno.test("createSubscription — a card subscription requires a token", async () => {
  const { p, calls } = provider([]);
  await assertRejects(
    () =>
      p.createSubscription({
        providerCustomerId: "cus_1",
        method: "credit_card",
        cycle: "monthly",
        amountCents: 199700,
        nextDueDate: "2026-09-03",
        description: "nope",
      }),
    Error,
    "token",
  );
  assertEquals(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Failure behaviour
// ---------------------------------------------------------------------------

Deno.test("provider errors carry the status but never the api key", async () => {
  const { p } = provider([{ status: 401, body: { errors: [{ description: "unauthorized" }] } }]);

  const err = await assertRejects(() => p.getCharge("pay_x"), Error);
  const message = (err as Error).message;
  assertEquals(message.includes("401"), true);
  assertEquals(
    message.includes("test-key-do-not-log"),
    false,
    "an api key in an error message ends up in runtime_logs",
  );
});

Deno.test("the api key travels in the header, not the query string", async () => {
  const { p, calls } = provider([
    { body: { id: "pay_4", customer: "c", billingType: "PIX", value: 10, status: "PENDING" } },
  ]);
  await p.getCharge("pay_4");
  assertEquals(calls[0].headers["access_token"], "test-key-do-not-log");
  assertEquals(calls[0].url.includes("test-key-do-not-log"), false);
});
