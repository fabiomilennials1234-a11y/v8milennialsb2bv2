import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillingSettings } from "./BillingSettings";

const fixture = vi.hoisted(() => ({
  admin: true,
  organizationId: "org-a",
  query: vi.fn(),
}));
vi.mock("@/modules/identity", () => ({
  useIdentity: () => ({ isAdmin: fixture.admin }),
  useOrganization: () => ({
    organizationId: fixture.organizationId,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../hooks/useBillingAccount", () => ({
  BILLING_PAGE_SIZE: 10,
  useBillingAccount: fixture.query,
}));

function result() {
  return {
    account: {
      data: {
        organization: {
          name: "Minha empresa",
          subscription_status: "active",
          billing_override: true,
        },
        subscription: null,
        planName: "Torque",
      },
      refetch: vi.fn(),
    },
    history: { data: { rows: [], count: 0 }, refetch: vi.fn() },
    quotas: { data: null, refetch: vi.fn() },
  };
}
beforeEach(() => {
  fixture.admin = true;
  fixture.organizationId = "org-a";
  fixture.query.mockReset().mockReturnValue(result());
});

describe("área de assinatura", () => {
  it("não consulta dados financeiros para um membro", () => {
    fixture.admin = false;
    render(<BillingSettings onContactSupport={vi.fn()} />);
    expect(screen.getByText("Acesso restrito")).toBeInTheDocument();
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it("distingue liberação manual de pagamento e abre atendimento", async () => {
    const support = vi.fn();
    render(<BillingSettings onContactSupport={support} />);
    expect(
      screen.getByText(/não representa confirmação de pagamento/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Falar sobre minha assinatura" }),
    );
    expect(support).toHaveBeenCalledOnce();
  });
  it("não transforma ausência de limite em ilimitado", async () => {
    render(<BillingSettings onContactSupport={vi.fn()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Plano e limites" }));
    expect(
      screen.getAllByText("O limite ainda não está disponível."),
    ).toHaveLength(3);
    expect(
      screen.queryByText(/Sem limite de quantidade/),
    ).not.toBeInTheDocument();
  });
  it("mantém os dados de admin sem exibir ações de suporte quando indisponíveis", async () => {
    render(<BillingSettings />);
    expect(screen.getByText(/não representa confirmação de pagamento/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Falar sobre minha assinatura" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Plano e limites" }));
    expect(screen.queryByRole("button", { name: "Solicitar alteração de plano" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Histórico de cobranças" }));
    expect(screen.queryByRole("button", { name: "Preciso de ajuda com um pagamento" })).not.toBeInTheDocument();
  });
  it("mostra falha de histórico em vez de dizer que não há cobranças", async () => {
    const data = result();
    fixture.query.mockReturnValue({
      ...data,
      history: { ...data.history, isError: true },
    });
    render(<BillingSettings onContactSupport={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("tab", { name: "Histórico de cobranças" }),
    );
    expect(
      screen.getByText("Não foi possível carregar esta seção"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nenhuma cobrança registrada"),
    ).not.toBeInTheDocument();
  });
  it("reinicia a consulta e a página quando a organização muda", () => {
    const { rerender } = render(<BillingSettings onContactSupport={vi.fn()} />);
    fixture.organizationId = "org-b";
    rerender(<BillingSettings onContactSupport={vi.fn()} />);
    expect(fixture.query).toHaveBeenLastCalledWith("org-b", true, 0);
  });
});
