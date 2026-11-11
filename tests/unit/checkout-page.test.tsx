/** N4: chave pública fora do ar não pode falhar em silêncio: a tela só diz "indisponível". */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CheckoutPage from "@/modules/billing/pages/CheckoutPage";
import { addErrorReporter, type ErrorReport } from "@/shared/errors";

const TOKEN = "tq_pay_0123456789abcdef";
const LINK = {
  amount_cents: 199700, expires_at: "2026-11-11T12:00:00Z", target_kind: "existing_org", display_name: "Riofix",
  next_charge_preview_at: "2026-12-04T12:00:00Z",
  plan: { slug: "torque-v8", name: "Copilot", billing_cycle: "monthly", cycle_months: 1, seats: 3 },
  totals: { subtotal_cents: 199700, cycle_discount_cents: 0, coupon_discount_cents: 0, manual_discount_cents: 0, monthly_cents: 199700, charge_cents: 199700 },
};

let reports: ErrorReport[];
let detach: () => void;

const renderPage = (state: unknown) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(state), { status: 200 })));
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/checkout/${TOKEN}`]}>
        <Routes><Route path="/checkout/:token" element={<CheckoutPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  reports = [];
  detach = addErrorReporter((r) => reports.push(r));
  vi.stubEnv("VITE_STRIPE_PUBLISHABLE_KEY", "");
});
afterEach(() => {
  detach();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("chave pública ausente", () => {
  it("link válido: indisponível, e relatório com nome fixo, sem token", async () => {
    renderPage({ state: "valid", link: LINK });
    await screen.findByRole("heading", { name: "Pagamento indisponível no momento" });
    expect(reports).toHaveLength(1);
    expect(JSON.stringify({ c: reports[0]!.context, r: reports[0]!.error.reference, m: reports[0]!.error.userMessage })).not.toContain(TOKEN);
    expect(String((reports[0]!.error.cause as Error).message)).toBe("checkout_publishable_key_invalid");
  });

  it("link inválido não relata: a falta de chave não afetou ninguém", async () => {
    renderPage({ state: "not_found" });
    await screen.findByRole("heading", { name: "Não encontramos este link" });
    expect(reports).toHaveLength(0);
  });
});
