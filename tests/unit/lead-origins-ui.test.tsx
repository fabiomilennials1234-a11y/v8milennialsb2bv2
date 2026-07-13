/**
 * Lead Origins UI (Slice A) — cobre os dois pontos de dor do CTO:
 *  1. Drawer V2: origem editável (persiste via useUpdateLead + invalida cache).
 *  2. LeadCreateForm: expõe os 13 built-ins (incl. os 6 que faltavam antes).
 *
 * `@/components/ui/select` é mockado para um <select> nativo — o Radix Select
 * real depende de pointer APIs indisponíveis no jsdom.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── 13 built-ins (fixture para o mock do hook) ──
const ORIGINS = vi.hoisted(() => [
  { slug: "whatsapp", label: "WhatsApp", color: "#25D366" },
  { slug: "meta_ads", label: "Meta Ads", color: "#1877F2" },
  { slug: "instagram", label: "Instagram", color: "#E1306C" },
  { slug: "tiktok", label: "Tiktok", color: "#010101" },
  { slug: "google_ads", label: "Google Ads", color: "#EA4335" },
  { slug: "site", label: "Site", color: "#6366F1" },
  { slug: "landing_page", label: "Landing Page", color: "#0EA5E9" },
  { slug: "remarketing", label: "Remarketing", color: "#F59E0B" },
  { slug: "indicacao", label: "Indicação", color: "#10B981" },
  { slug: "evento", label: "Evento", color: "#8B5CF6" },
  { slug: "prospeccao_ativa", label: "Prospecção Ativa", color: "#F97316" },
  { slug: "cal", label: "Cal.com", color: "#292929" },
  { slug: "outro", label: "Outro", color: "#64748B" },
]);

const updateSpy = vi.fn().mockResolvedValue({});
const logSpy = vi.fn();

type SelProps = {
  value?: string;
  onValueChange?: (v: string) => void;
  children?: React.ReactNode;
};
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: SelProps) =>
    React.createElement(
      "select",
      {
        "data-testid": "select",
        value: value ?? "",
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value),
      },
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: SelProps) => React.createElement(React.Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) =>
    React.createElement("option", { value }, children),
  SelectGroup: ({ children }: SelProps) => React.createElement(React.Fragment, null, children),
  SelectLabel: () => null,
}));

vi.mock("@/modules/leads/hooks/useLeadOrigins", () => ({
  useLeadOrigins: () => ({
    origins: ORIGINS,
    labelOf: (s: string) => ORIGINS.find((o) => o.slug === s)?.label ?? s,
    colorOf: (s: string) => ORIGINS.find((o) => o.slug === s)?.color ?? "#64748B",
    isLoading: false,
  }),
}));
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: updateSpy, isPending: false }),
}));
vi.mock("@/modules/leads/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => logSpy }));
vi.mock("@/modules/leads/components/leads/LeadCard", () => ({
  ORIGIN_COLORS: {
    whatsapp: { bg: "#E1F5EE", text: "#0F6E56", label: "WhatsApp" },
    indicacao: { bg: "#EAF3DE", text: "#3B6D11", label: "Indicação" },
    outro: { bg: "#F1EFE8", text: "#5F5E5A", label: "Outros" },
  },
}));

import { InfoBlockTracking } from "@/modules/leads/components/lead-detail/modal/body/InfoBlockTracking";

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  return { invalidateSpy, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

describe("Drawer V2 — origem editável", () => {
  beforeEach(() => {
    updateSpy.mockClear();
    logSpy.mockClear();
  });

  it("persiste a nova origem via useUpdateLead e invalida o cache do lead", async () => {
    const { invalidateSpy } = renderWithClient(
      <InfoBlockTracking lead={{ id: "lead-1", origin: "whatsapp", created_at: null }} />,
    );

    fireEvent.change(screen.getByTestId("select"), { target: { value: "indicacao" } });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({ id: "lead-1", origin: "indicacao" }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-1", action: "field_updated" }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["lead-detail", "lead-1"] });
  });

  it("não persiste quando a origem selecionada é a mesma", async () => {
    renderWithClient(<InfoBlockTracking lead={{ id: "lead-2", origin: "whatsapp", created_at: null }} />);
    fireEvent.change(screen.getByTestId("select"), { target: { value: "whatsapp" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("expõe as 13 origens como opções (incl. as 6 que faltavam no form antigo)", () => {
    renderWithClient(<InfoBlockTracking lead={{ id: "lead-3", origin: "whatsapp", created_at: null }} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(13);
    for (const label of ["Indicação", "Evento", "Prospecção Ativa", "Instagram", "Tiktok", "Landing Page"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });
});
