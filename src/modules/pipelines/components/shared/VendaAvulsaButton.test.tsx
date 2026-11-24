import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VendaAvulsaButton } from "./VendaAvulsaButton";

const { from, rpc, notifyError } = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), notifyError: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));
vi.mock("@/shared/errors", () => ({ notifyError }));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({
    organizationId: "org-1", teamMemberId: "seller-1", timezone: "America/Sao_Paulo",
  }),
  useFeaturePermission: () => ({ allowed: true }),
  useResponsibleMembers: () => [{ id: "seller-1", name: "Ana" }],
}));

it("registra o negócio ganho pelo RPC do funil e reutiliza o id se a resposta falhar", async () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  from.mockReturnValue(query);
  rpc.mockResolvedValueOnce({ error: new Error("Conexão interrompida") }).mockResolvedValue({ error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <VendaAvulsaButton pipelineId="funil-1" pipelineName="Funil de vendas" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Registrar venda avulsa" }));
  fireEvent.change(screen.getByLabelText("Nome da venda"), { target: { value: "Venda de balcão" } });
  fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "123456" } });
  const dateInput = screen.getByLabelText("Data da venda");
  fireEvent.change(dateInput, { target: { value: "2026-01-10" } });

  fireEvent.click(screen.getByRole("button", { name: "Registrar venda" }));
  await waitFor(() => expect(notifyError).toHaveBeenCalledOnce());
  expect(rpc).toHaveBeenCalledWith("registrar_venda_avulsa", {
    p_organization_id: "org-1",
    p_pipeline_id: "funil-1",
    p_request_id: expect.any(String),
    p_title: "Venda de balcão",
    p_value: 1234.56,
    p_date: "2026-01-10",
    p_owner_id: "seller-1",
  });

  fireEvent.click(screen.getByRole("button", { name: "Registrar venda" }));
  await waitFor(() => expect(screen.getByLabelText("Nome da venda")).toHaveValue(""));
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  expect(from.mock.calls.every(([table]) => table === "deals")).toBe(true);
});
