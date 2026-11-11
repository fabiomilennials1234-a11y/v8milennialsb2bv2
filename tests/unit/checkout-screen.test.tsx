/**
 * O fluxo da tela sem a Stripe de verdade: quem cobra o caminho real é
 * tests/e2e/checkout/checkout.spec.ts, que precisa de chave de teste e não roda no CI comum.
 * Aqui ficam as travas que não podem depender de chave: autorização antes do POST, trava de
 * valor, livemode, documento fora do DOM, SKU fora do DOM.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CheckoutScreen } from "@/modules/billing/components/checkout/CheckoutScreen";
import { fetchCheckoutLink, startSubscription } from "@/modules/billing/lib/checkout-api";
import type { CheckoutLink } from "@/modules/billing/lib/checkout-api";

const elementsSpy = vi.fn();
const stripeMock = vi.hoisted(() => ({ value: null as null | { confirmPayment: () => Promise<unknown> } }));
vi.mock("@stripe/stripe-js/pure", () => ({
  loadStripe: vi.fn(async () => ({ retrievePaymentIntent: vi.fn() })),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children, options }: { children: ReactNode; options: unknown }) => {
    elementsSpy(options);
    return <div data-testid="elements">{children}</div>;
  },
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => stripeMock.value,
  useElements: () => (stripeMock.value ? {} : null),
}));

const TOKEN = "tq_pay_0123456789abcdef";
const SECRET = "pi_123_secret_456";
const LINK: CheckoutLink = {
  amount_cents: 1078380,
  expires_at: "2026-11-11T12:00:00Z",
  target_kind: "existing_org",
  display_name: "Riofix Indústria Ltda",
  next_charge_preview_at: "2027-05-04T12:00:00Z",
  plan: { slug: "torque-v8", name: "Copilot", billing_cycle: "semiannual", cycle_months: 6, seats: 3 },
  totals: { subtotal_cents: 199700, cycle_discount_cents: 19970, coupon_discount_cents: 0, manual_discount_cents: 0, monthly_cents: 179730, charge_cents: 1078380 },
};

function mockFetch(responder: (url: string, body: Record<string, unknown>) => { status?: number; json: unknown }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body });
    const r = responder(url, body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }));
  return calls;
}

const ready = { state: "ready", client_secret: SECRET, livemode: false, amount_cents: 1078380, billing_cycle: "semiannual" };

function renderScreen(link = LINK) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CheckoutScreen
        token={TOKEN}
        link={link}
        publishableKey={{ ok: true, key: "pk_test_abc", livemode: false }}
        initialPaid={false}
        redirectSecret={null}
        onRetry={() => undefined}
      />
    </QueryClientProvider>,
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>, { consent = true } = {}) {
  await user.type(screen.getByLabelText("Razão social ou nome"), "Riofix Indústria Ltda");
  await user.type(screen.getByLabelText("CNPJ ou CPF"), "11222333000181");
  await user.type(screen.getByLabelText("E-mail"), "financeiro@riofix.com.br");
  if (consent) await user.click(screen.getByRole("checkbox"));
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Continuar para o cartão" }));

beforeEach(() => {
  elementsSpy.mockClear();
  stripeMock.value = null;
  vi.unstubAllGlobals();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
});

describe("etapa do comprador", () => {
  it("sem autorização não há POST, e o foco vai para a marcação", async () => {
    const calls = mockFetch(() => ({ json: ready }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user, { consent: false });
    await submit(user);
    expect(screen.getByText("Marque a autorização para continuar.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveFocus();
    expect(calls).toHaveLength(0);
  });

  it("campo vazio foca no primeiro inválido e não ecoa valor", async () => {
    const calls = mockFetch(() => ({ json: ready }));
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText("CNPJ ou CPF"), "11222333000182");
    await submit(user);
    expect(screen.getByLabelText("Razão social ou nome")).toHaveFocus();
    expect(screen.getByText("Documento inválido. Confira os dígitos.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("o POST leva o aceite versionado e só dígitos; preço, plano e org não saem daqui", async () => {
    const calls = mockFetch(() => ({ json: ready }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    await screen.findByTestId("payment-element");
    expect(calls[0]!.body).toEqual({
      token: TOKEN,
      buyer: { legal_name: "Riofix Indústria Ltda", email: "financeiro@riofix.com.br", tax_id: "11222333000181" },
      consent: { accepted: true, version: "2026-11-04" },
    });
  });

  it("depois do POST, documento inteiro e client_secret fora do DOM; SKU nunca", async () => {
    mockFetch(() => ({ json: ready }));
    const user = userEvent.setup();
    const { container } = renderScreen();
    await fill(user);
    await submit(user);
    await screen.findByText("CNPJ terminado em 81");
    const html = container.innerHTML;
    expect(html).not.toContain("11222333000181");
    expect(html).not.toContain("11.222.333/0001-81");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("torque-v8");
  });

  it("recusa de campo do servidor volta inline, com foco, e preserva o formulário", async () => {
    mockFetch(() => ({ json: { state: "email_invalid" } }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    await screen.findByText("E-mail inválido. Confira o endereço.");
    expect(screen.getByLabelText("E-mail")).toHaveFocus();
    expect(screen.getByLabelText("Razão social ou nome")).toHaveValue("Riofix Indústria Ltda");
  });

  it("429 no POST avisa e preserva", async () => {
    mockFetch(() => ({ status: 429, json: { state: "rate_limited" } }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    await screen.findByText(/Muitas tentativas em pouco tempo/);
    expect(screen.getByLabelText("CNPJ ou CPF")).toHaveValue("11.222.333/0001-81");
  });

  it("clique duplo não cria dois POST", async () => {
    let release: (v: unknown) => void = () => undefined;
    const gate = new Promise((r) => { release = r; });
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      count += 1;
      await gate;
      return new Response(JSON.stringify(ready), { status: 200 });
    }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    fireEvent.click(screen.getByRole("button", { name: /Conferindo os dados/ }));
    release(null);
    await screen.findByTestId("payment-element");
    expect(count).toBe(1);
  });
});

describe("travas antes de montar o Elements", () => {
  it.each([
    ["valor diferente do link", { amount_cents: 1 }],
    ["ciclo diferente do link", { billing_cycle: "annual" }],
    ["livemode divergente da chave", { livemode: true }],
  ])("%s: não monta", async (_nome, patch) => {
    mockFetch(() => ({ json: { ...ready, ...patch } }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    await screen.findByRole("heading", { name: "Pagamento indisponível no momento" });
    expect(elementsSpy).not.toHaveBeenCalled();
  });

  it("consent_required é bundle defasado: pede recarga e não monta", async () => {
    mockFetch(() => ({ json: { state: "consent_required", consent_version: "2030-01-01" } }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    await screen.findByRole("heading", { name: "Esta página foi atualizada" });
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
    expect(elementsSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["link_expired", "Esta proposta venceu"],
    ["link_revoked", "Este link foi cancelado"],
    ["already_paid", "Este link já foi pago"],
    ["target_not_supported", "Este link não pode ser pago aqui"],
    ["org_already_subscribed", "Riofix Indústria Ltda já tem uma assinatura em andamento"],
  ])("POST %s vira terminal", async (state, title) => {
    mockFetch(() => ({ json: { state } }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    await waitFor(() => expect(screen.getByRole("heading", { name: title })).toHaveFocus());
  });
});

describe("confirmPayment", () => {
  it("promise rejeitada (erro de integração) não prende em Processando e libera nova tentativa", async () => {
    stripeMock.value = { confirmPayment: vi.fn(async () => { throw new Error("IntegrationError com dado"); }) };
    mockFetch(() => ({ json: ready }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    await user.click(await screen.findByRole("button", { name: /^Pagar / }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).not.toContain("IntegrationError");
    expect(screen.getByRole("button", { name: /^Pagar / })).toBeInTheDocument();
  });
});

describe("Alterar", () => {
  it("volta com nome e e-mail, documento vazio e a ajuda", async () => {
    mockFetch(() => ({ json: ready }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    await user.click(await screen.findByRole("button", { name: "Alterar" }));
    expect(screen.getByLabelText("Razão social ou nome")).toHaveValue("Riofix Indústria Ltda");
    expect(screen.getByLabelText("E-mail")).toHaveValue("financeiro@riofix.com.br");
    expect(screen.getByLabelText("CNPJ ou CPF")).toHaveValue("");
    expect(screen.getByText("Por segurança, digite o documento de novo.")).toBeInTheDocument();
    expect(elementsSpy).toHaveBeenCalled();
    expect(screen.queryByTestId("payment-element")).toBeNull();
  });
});

describe("transporte", () => {
  it("link: estado desconhecido não vira formulário de cobrança", async () => {
    mockFetch(() => ({ json: { state: "novo_estado" } }));
    expect(await fetchCheckoutLink(TOKEN)).toEqual({ kind: "unavailable" });
  });
  it("link: 429 e rede caída têm desfechos próprios, sem lançar", async () => {
    mockFetch(() => ({ status: 429, json: {} }));
    expect(await fetchCheckoutLink(TOKEN)).toEqual({ kind: "rate_limited" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await fetchCheckoutLink(TOKEN)).toEqual({ kind: "offline" });
  });
  it("POST: 503 e 500 são indisponível; ready sem campo também", async () => {
    mockFetch(() => ({ status: 503, json: { state: "billing_not_configured" } }));
    const input = { token: TOKEN, buyer: { legal_name: "a", email: "a@b.c", tax_id: "1" }, consent: { accepted: true as const, version: "x" } };
    expect(await startSubscription(input)).toEqual({ kind: "unavailable" });
    mockFetch(() => ({ status: 500, json: { error: "internal_error" } }));
    expect(await startSubscription(input)).toEqual({ kind: "unavailable" });
    mockFetch(() => ({ json: { state: "ready" } }));
    expect(await startSubscription(input)).toEqual({ kind: "unavailable" });
  });
});

describe("volta C: só afirma recusa com recusa explícita", () => {
  type StripeFake = { confirmPayment: ReturnType<typeof vi.fn>; retrievePaymentIntent: ReturnType<typeof vi.fn> };
  const paying = async (stripe: StripeFake) => {
    stripeMock.value = stripe as never;
    mockFetch(() => ({ json: ready }));
    const user = userEvent.setup();
    renderScreen();
    await fill(user);
    await submit(user);
    await user.click(await screen.findByRole("button", { name: /^Pagar / }));
    return user;
  };

  it.each(["api_connection_error", "api_error", "desconhecido"])("%s com PI pago: mostra confirmado", async (type) => {
    await paying({
      confirmPayment: vi.fn(async () => ({ error: { type } })),
      retrievePaymentIntent: vi.fn(async () => ({ paymentIntent: { status: "succeeded", amount: 1078380 } })),
    });
    await screen.findByRole("heading", { name: "Pagamento confirmado" });
  });

  it("promise rejeitada com PI pago: mostra confirmado", async () => {
    await paying({
      confirmPayment: vi.fn(async () => { throw new TypeError("Failed to fetch"); }),
      retrievePaymentIntent: vi.fn(async () => ({ paymentIntent: { status: "succeeded", amount: 1078380 } })),
    });
    await screen.findByRole("heading", { name: "Pagamento confirmado" });
  });

  it("erro de conexão sem resposta do PI: nunca diz recusa nem Nada foi cobrado", async () => {
    await paying({
      confirmPayment: vi.fn(async () => ({ error: { type: "api_connection_error" } })),
      retrievePaymentIntent: vi.fn(async () => { throw new TypeError("rede"); }),
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Não foi possível confirmar o pagamento");
    expect(alert.textContent).toContain("não cobra duas vezes");
    expect(alert.textContent).not.toContain("Nada foi cobrado");
    expect(alert.textContent).not.toContain("recusou");
  });

  it("card_error segue dizendo recusa, sem consultar nada", async () => {
    const retrieve = vi.fn();
    await paying({
      confirmPayment: vi.fn(async () => ({ error: { type: "card_error", code: "card_declined", decline_code: "generic_decline" } })),
      retrievePaymentIntent: retrieve,
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("O banco recusou");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("3DS falho (invalid_request_error com código explícito) é recusa", async () => {
    await paying({
      confirmPayment: vi.fn(async () => ({ error: { type: "invalid_request_error", code: "payment_intent_authentication_failure" } })),
      retrievePaymentIntent: vi.fn(),
    });
    expect((await screen.findByRole("alert")).textContent).toContain("A confirmação no banco não foi concluída");
  });

  it("Q5: Alterar travado enquanto processa", async () => {
    let finish: (v: unknown) => void = () => undefined;
    await paying({
      confirmPayment: vi.fn(() => new Promise((r) => { finish = r; })),
      retrievePaymentIntent: vi.fn(),
    });
    await screen.findByRole("button", { name: /Processando pagamento/ });
    expect(screen.getByRole("button", { name: "Alterar" })).toBeDisabled();
    finish({ error: { type: "card_error", code: "card_declined" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Alterar" })).toBeEnabled());
  });
});

describe("volta F4: volta do banco confere o valor antes de celebrar", () => {
  const resume = async (paymentIntent: Record<string, unknown>) => {
    const { loadStripe } = await import("@stripe/stripe-js/pure");
    vi.mocked(loadStripe).mockResolvedValueOnce({ retrievePaymentIntent: vi.fn(async () => ({ paymentIntent })) } as never);
    mockFetch(() => ({ json: { state: "pending" } }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CheckoutScreen token={TOKEN} link={LINK} publishableKey={{ ok: true, key: "pk_test_abc", livemode: false }} initialPaid={false} redirectSecret={SECRET} onRetry={() => undefined} />
      </QueryClientProvider>,
    );
  };
  it("valor igual: confirmado", async () => {
    await resume({ status: "succeeded", amount: LINK.amount_cents });
    await screen.findByRole("heading", { name: "Pagamento confirmado" });
  });
  it("PaymentIntent inacessível na volta do banco: não afirma que nada foi cobrado", async () => {
    const { loadStripe } = await import("@stripe/stripe-js/pure");
    vi.mocked(loadStripe).mockResolvedValueOnce({ retrievePaymentIntent: vi.fn(async () => { throw new Error("rede"); }) } as never);
    mockFetch(() => ({ json: { state: "pending" } }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CheckoutScreen token={TOKEN} link={LINK} publishableKey={{ ok: true, key: "pk_test_abc", livemode: false }} initialPaid={false} redirectSecret={SECRET} onRetry={() => undefined} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Não conseguimos confirmar o pagamento" });
    expect(document.body.textContent).not.toMatch(/nada foi cobrado/i);
  });

  it("valor diferente: indisponível, sem marca de pago", async () => {
    await resume({ status: "succeeded", amount: 1 });
    await screen.findByRole("heading", { name: "Pagamento indisponível no momento" });
    expect(screen.queryByRole("heading", { name: "Pagamento confirmado" })).toBeNull();
  });
});

describe("volta Q7: token impossível nem chega à rede", () => {
  it.each(["\u0000", "a b"])("%j", async (token) => {
    const calls = mockFetch(() => ({ json: { state: "valid" } }));
    expect(await fetchCheckoutLink(token)).toEqual({ kind: "not_found" });
    expect(calls).toHaveLength(0);
  });
});
