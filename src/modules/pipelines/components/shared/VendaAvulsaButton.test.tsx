import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VendaAvulsaButton } from "./VendaAvulsaButton";

const RIOFIX = "36971ff5-fd73-4f30-a733-04bf8c90e5b6";
const MUSTANG = "a9a2f3cb-63fe-4ca1-a453-f27002cc4944";

const { from, upsert, notifyError, identity } = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  notifyError: vi.fn(),
  identity: { organizationId: "", viewAll: true },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/shared/errors", () => ({ notifyError }));
vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
  useOrganization: () => ({ organizationId: identity.organizationId, teamMemberId: "seller-1", timezone: "America/Sao_Paulo" }),
  useFeaturePermission: (key: string) => ({ allowed: key !== "pipeline.view_all" || identity.viewAll, isLoading: false }),
  useTeamMembers: () => ({ data: [{ id: "seller-1", name: "Ana", is_active: true }] }),
}));

function openButton(pipelineId = MUSTANG) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VendaAvulsaButton pipelineId={pipelineId} />
    </QueryClientProvider>,
  );
}

const salesQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  abortSignal: vi.fn(),
  upsert,
};

beforeEach(() => {
  vi.clearAllMocks();
  identity.organizationId = RIOFIX;
  identity.viewAll = true;
  from.mockReturnValue(salesQuery);
  salesQuery.abortSignal.mockResolvedValue({ data: [], error: null });
  upsert.mockReset().mockResolvedValue({ error: null });
});

afterEach(cleanup);

it("exibe a ação só no Funil Mustang da Riofix", () => {
  const view = openButton("outro-funil");
  expect(screen.queryByRole("button", { name: "Registrar venda avulsa" })).not.toBeInTheDocument();
  view.unmount();
  identity.organizationId = "outra-org";
  openButton();
  expect(screen.queryByRole("button", { name: "Registrar venda avulsa" })).not.toBeInTheDocument();
  expect(from).not.toHaveBeenCalled();
});

it("grava em negócios sem lead e reaproveita o id ao repetir um envio", async () => {
  upsert.mockResolvedValueOnce({ error: new Error("Conexão interrompida") });
  openButton();
  fireEvent.click(screen.getByRole("button", { name: "Registrar venda avulsa" }));
  fireEvent.change(screen.getByLabelText("Nome da venda"), { target: { value: "Venda de balcão" } });
  fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("Data da venda"), { target: { value: "2026-01-10" } });

  fireEvent.click(screen.getByRole("button", { name: "Registrar venda" }));
  await waitFor(() => expect(notifyError).toHaveBeenCalledOnce());
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
    id: expect.any(String),
    organization_id: RIOFIX,
    created_by: "user-1",
    metadata: { venda_avulsa: true, pipeline_id: MUSTANG },
    title: "Venda de balcão",
    value: 1234.56,
    source_lead_id: null,
    owner_id: "seller-1",
    outcome: "won",
    won: true,
    closed_at: "2026-01-10T03:00:00.000Z",
    outcome_at: "2026-01-10T03:00:00.000Z",
  }), { onConflict: "id", ignoreDuplicates: true });

  fireEvent.click(screen.getByRole("button", { name: "Registrar venda" }));
  await waitFor(() => expect(screen.getByLabelText("Nome da venda")).toHaveValue(""));
  expect(upsert).toHaveBeenCalledTimes(2);
  expect(upsert.mock.calls[0]).toEqual(upsert.mock.calls[1]);
  expect(from.mock.calls.every(([table]) => table === "deals")).toBe(true);
});

it("soma o recorte de vendas avulsas e filtra o mês no fuso da Riofix", async () => {
  salesQuery.abortSignal.mockResolvedValue({ data: [
    { id: "1", title: "Total de 07/11", value: 42214.26, closed_at: "2026-11-07T15:00:00Z", owner_id: null },
    { id: "2", title: "Total de 09/11", value: 17911.86, closed_at: "2026-11-09T15:00:00Z", owner_id: null },
  ], error: null });
  openButton();
  fireEvent.click(screen.getByRole("button", { name: "Registrar venda avulsa" }));
  fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "2026-11" } });
  expect(await screen.findByText(/R\$\s60\.126,12/)).toBeInTheDocument();
  expect(screen.getByText("Total de vendas avulsas (2)")).toBeInTheDocument();
  expect(salesQuery.gte).toHaveBeenCalledWith("closed_at", "2026-11-01T03:00:00.000Z");
  expect(salesQuery.lt).toHaveBeenCalledWith("closed_at", "2026-12-01T03:00:00.000Z");
  expect(salesQuery.eq).toHaveBeenCalledWith("metadata->>pipeline_id", MUSTANG);
  expect(salesQuery.is).toHaveBeenCalledWith("source_lead_id", null);
});

it("limita o histórico ao próprio vendedor quando a visualização é restrita", async () => {
  identity.viewAll = false;
  openButton();
  fireEvent.click(screen.getByRole("button", { name: "Registrar venda avulsa" }));
  await waitFor(() => expect(salesQuery.eq).toHaveBeenCalledWith("owner_id", "seller-1"));
  expect(screen.queryByLabelText("Filtrar por vendedor")).not.toBeInTheDocument();
});
