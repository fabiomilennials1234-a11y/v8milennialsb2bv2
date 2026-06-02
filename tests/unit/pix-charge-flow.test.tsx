/**
 * Sprint 5 — useCreateAsaasPixCharge + SendPixButton render tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { organization_id: "org-a", id: "tm-1", user_id: "u-1" },
  }),
}));

import { useCreateAsaasPixCharge } from "@/hooks/useCreateAsaasPixCharge";
import { SendPixButton } from "@/components/pipe-propostas/SendPixButton";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("useCreateAsaasPixCharge", () => {
  it("calls checkout-create-payment with method=PIX", async () => {
    invokeMock.mockResolvedValue({
      data: {
        charge_id: "ch-1",
        pixkey: "11122233344",
        pixkey_type: "cpf",
        merchant_name: "Loja",
        amount: 100,
      },
      error: null,
    });
    const { result } = renderHook(() => useCreateAsaasPixCharge(), { wrapper });
    const out = await result.current.mutateAsync({
      lead_id: "lead-1",
      organization_id: "org-a",
      amount: 100,
    });
    expect(invokeMock).toHaveBeenCalledWith("checkout-create-payment", {
      body: {
        method: "PIX",
        lead_id: "lead-1",
        organization_id: "org-a",
        amount: 100,
        description: undefined,
        due_days: 1,
      },
    });
    expect(out.charge_id).toBe("ch-1");
  });

  it("throws on invalid response", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useCreateAsaasPixCharge(), { wrapper });
    await expect(
      result.current.mutateAsync({
        lead_id: "lead-1",
        organization_id: "org-a",
        amount: 100,
      })
    ).rejects.toThrow(/Resposta inválida/);
  });

  it("propagates edge function error", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "Asaas down" },
    });
    const { result } = renderHook(() => useCreateAsaasPixCharge(), { wrapper });
    await expect(
      result.current.mutateAsync({
        lead_id: "lead-1",
        organization_id: "org-a",
        amount: 100,
      })
    ).rejects.toThrow(/Asaas down/);
  });
});

describe("SendPixButton", () => {
  it("disables when leadPhone missing", () => {
    render(
      <SendPixButton
        leadId="l-1"
        leadPhone={null}
        leadName="João"
        saleValue={100}
        instanceId="i-1"
      />,
      { wrapper }
    );
    expect(screen.getByRole("button", { name: /Cobrança PIX/i })).toBeDisabled();
  });

  it("disables when instanceId null", () => {
    render(
      <SendPixButton
        leadId="l-1"
        leadPhone="5511999999999"
        saleValue={100}
        instanceId={null}
      />,
      { wrapper }
    );
    expect(screen.getByRole("button", { name: /Cobrança PIX/i })).toBeDisabled();
  });

  it("disables when saleValue<=0", () => {
    render(
      <SendPixButton
        leadId="l-1"
        leadPhone="5511999999999"
        saleValue={0}
        instanceId="i-1"
      />,
      { wrapper }
    );
    expect(screen.getByRole("button", { name: /Cobrança PIX/i })).toBeDisabled();
  });

  it("enabled when all preconditions met", () => {
    render(
      <SendPixButton
        leadId="l-1"
        leadPhone="5511999999999"
        saleValue={100}
        instanceId="i-1"
      />,
      { wrapper }
    );
    expect(screen.getByRole("button", { name: /Cobrança PIX/i })).not.toBeDisabled();
  });
});
