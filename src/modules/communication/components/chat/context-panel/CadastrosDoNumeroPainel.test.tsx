import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeTables } from "../../../../../../tests/helpers/fake-supabase-tables";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  enabled: true,
  org: "cafe",
  rpc: vi.fn(),
  from: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabaseTables } =
    await import("../../../../../../tests/helpers/fake-supabase-tables");
  return {
    supabase: {
      from: (table: string) => {
        h.from(table);
        return fakeSupabaseTables(h.tables as FakeTables).supabase.from(table);
      },
      rpc: (...args: unknown[]) => h.rpc(...args),
    },
  };
});
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: h.org }),
  useCurrentTeamMember: () => ({ data: { organization_id: h.org } }),
}));
vi.mock("@/modules/platform", () => ({
  useFeatureFlag: () => ({ enabled: h.enabled }),
}));
vi.mock("@/modules/communication/components/chat/LeadContactModal", () => ({
  LeadContactModal: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: h.success } }));
vi.mock("@/shared/errors", () => ({ notifyError: h.error }));

import {
  CadastrosDoNumeroMobile,
  CadastrosDoNumeroPainel,
} from "./CadastrosDoNumeroPainel";

const PHONE = "5548999991234";
const NORM = "48999991234";
const lead = (id: string, org = "cafe") => ({
  id,
  organization_id: org,
  name: `Cliente ${id}`,
  company: `Empresa ${id}`,
  erp_code: id,
  normalized_phone: NORM,
  deleted_at: null,
});
function mount(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.enabled = true;
  h.org = "cafe";
  vi.clearAllMocks();
  h.rpc.mockResolvedValue({ data: 2, error: null });
  h.tables = {
    leads: [
      lead("1"),
      lead("2"),
      lead("segredo", "outra-org"),
      { ...lead("excluido"), deleted_at: "2026-11-16" },
    ],
    lead_phones: [],
    negocio_projetado: [
      {
        organization_id: "cafe",
        lead_id: "2",
        closed_at: null,
        pipeline_name: "Vendas",
        stage_name: "Proposta",
        stage_is_final_positive: false,
        stage_is_final_negative: false,
      },
    ],
  };
});

describe("cadastros no painel da conversa", () => {
  it("mostra negócios e vínculo na lateral sem misturar outra organização ou excluídos", async () => {
    mount(<CadastrosDoNumeroPainel telefone={PHONE} leadIdDaConversa="1" />);
    const region = await screen.findByRole("region", {
      name: "Cadastros deste número",
    });
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(within(region).getAllByRole("link")[0]).toHaveTextContent(
      "Cliente 2",
    );
    expect(within(region).getByText("Vendas · Proposta")).toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: /Cliente 1/ }),
    ).toHaveTextContent("nesta conversa");
    expect(screen.queryByText(/segredo|excluido/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Vincular esta conversa/ }),
    ).not.toBeInTheDocument();
  });

  it("sem lead, apresenta uma única lista e mantém a escolha pela RPC existente", async () => {
    mount(<CadastrosDoNumeroPainel telefone={PHONE} leadIdDaConversa={null} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Vincular esta conversa a Cliente 2",
      }),
    );
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(screen.getAllByRole("list")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Criar ou vincular lead" }),
    ).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("escolher_lead_do_numero", {
      p_organization_id: "cafe",
      p_phone: PHONE,
      p_lead_id: "2",
    });
  });

  it("uma recusa do vínculo permanece erro, sem anunciar sucesso", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "access_denied" },
    });
    mount(<CadastrosDoNumeroPainel telefone={PHONE} leadIdDaConversa={null} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Vincular esta conversa a Cliente 1",
      }),
    );
    await waitFor(() => expect(h.error).toHaveBeenCalled());
    expect(h.success).not.toHaveBeenCalled();
  });

  it("flag desligada mantém o fallback e não consulta os cadastros", () => {
    h.enabled = false;
    mount(
      <CadastrosDoNumeroPainel
        telefone={PHONE}
        leadIdDaConversa={null}
        fallback={<p>Informações usuais</p>}
      />,
    );
    expect(screen.getByText("Informações usuais")).toBeInTheDocument();
    expect(h.from).not.toHaveBeenCalled();
  });

  it("grupo não mostra nem consulta cadastros", () => {
    mount(
      <CadastrosDoNumeroMobile telefone={PHONE} leadIdDaConversa="1" isGroup />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(h.from).not.toHaveBeenCalled();
  });

  it("mobile mantém a lista fora da conversa até abrir o painel e permite fechar", async () => {
    mount(<CadastrosDoNumeroMobile telefone={PHONE} leadIdDaConversa="1" />);
    const open = await screen.findByRole("button", {
      name: "Ver 2 cadastros deste número",
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", {
      name: "Cadastros deste número",
    });
    expect(await within(dialog).findByText("Cliente 2")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
