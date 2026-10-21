import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LossReasonSettings } from "./LossReasonSettings";

const RIOFIX = "36971ff5-fd73-4f30-a733-04bf8c90e5b6";
const mock = vi.hoisted(() => ({
  organizationId: "36971ff5-fd73-4f30-a733-04bf8c90e5b6" as string | null,
  isAdmin: true,
  query: { data: [] as { id: string; name: string }[], isLoading: false, isError: false, refetch: vi.fn() },
  useLossReasons: vi.fn(),
  mutation: { mutateAsync: vi.fn(), isPending: false },
  success: vi.fn(), notifyError: vi.fn(),
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: mock.organizationId }),
  useIdentity: () => ({ isAdmin: mock.isAdmin }),
}));
vi.mock("@/modules/pipelines", async () => ({
  ...await import("../../../pipelines/lib/loss-reason-settings"),
  useLossReasons: () => { mock.useLossReasons(); return mock.query; },
  useRenameLossReason: () => mock.mutation,
}));
vi.mock("sonner", () => ({ toast: { success: mock.success } }));
vi.mock("@/shared/errors", () => ({ notifyError: mock.notifyError }));

beforeEach(() => {
  vi.clearAllMocks();
  mock.organizationId = RIOFIX;
  mock.isAdmin = true;
  mock.query.data = [{ id: "reason-1", name: "Preco" }, { id: "reason-2", name: "Timing" }];
  mock.query.isLoading = false;
  mock.query.isError = false;
  mock.mutation.isPending = false;
  mock.mutation.mutateAsync.mockResolvedValue({ id: "reason-1", name: "Preço" });
});

it.each([["outra-org", true], [null, true], [RIOFIX, false]])("não monta o editor nem consulta o catálogo fora do piloto/admin (%s, %s)", (org, admin) => {
  mock.organizationId = org;
  mock.isAdmin = admin;
  const { container } = render(<LossReasonSettings />);
  expect(container).toBeEmptyDOMElement();
  expect(mock.useLossReasons).not.toHaveBeenCalled();
});

it("lista motivos e salva o nome aparado mantendo o ID", async () => {
  render(<LossReasonSettings />);
  expect(screen.getByText("Timing")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Editar motivo Preco" }));
  fireEvent.change(screen.getByLabelText("Nome do motivo"), { target: { value: "  Preço  " } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(mock.success).toHaveBeenCalledWith("Motivo de perda atualizado."));
  expect(mock.mutation.mutateAsync).toHaveBeenCalledWith({ id: "reason-1", name: "Preço" });
  expect(screen.queryByLabelText("Nome do motivo")).not.toBeInTheDocument();
});

it("desabilita salvar sem mudança ou com nome vazio; cancelar não escreve", () => {
  render(<LossReasonSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Editar motivo Preco" }));
  expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nome do motivo"), { target: { value: "   " } });
  expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(mock.mutation.mutateAsync).not.toHaveBeenCalled();
});

it("mantém o rascunho quando a gravação falha e mostra um erro amigável", async () => {
  const error = new Error("permission denied");
  mock.mutation.mutateAsync.mockRejectedValue(error);
  render(<LossReasonSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Editar motivo Preco" }));
  fireEvent.change(screen.getByLabelText("Nome do motivo"), { target: { value: "Preço" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(mock.notifyError).toHaveBeenCalled());
  expect(screen.getByLabelText("Nome do motivo")).toHaveValue("Preço");
  expect(mock.success).not.toHaveBeenCalled();
});

it("bloqueia novos envios e troca de motivo durante a gravação", () => {
  const { rerender } = render(<LossReasonSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Editar motivo Preco" }));
  mock.mutation.isPending = true;
  rerender(<LossReasonSettings />);
  expect(screen.getByLabelText("Nome do motivo")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Editar motivo Timing" })).toBeDisabled();
});

it("descarta o formulário ao sair da Riofix e voltar", () => {
  const { rerender } = render(<LossReasonSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Editar motivo Preco" }));
  mock.organizationId = "outra-org";
  rerender(<LossReasonSettings />);
  expect(screen.queryByLabelText("Nome do motivo")).not.toBeInTheDocument();
  mock.organizationId = RIOFIX;
  rerender(<LossReasonSettings />);
  expect(screen.queryByLabelText("Nome do motivo")).not.toBeInTheDocument();
});

it("mostra carregamento, falha com nova tentativa e catálogo vazio", () => {
  mock.query.isLoading = true;
  const { rerender } = render(<LossReasonSettings />);
  expect(screen.getByRole("status")).toHaveTextContent("Carregando");
  mock.query.isLoading = false;
  mock.query.isError = true;
  rerender(<LossReasonSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(mock.query.refetch).toHaveBeenCalledOnce();
  mock.query.isError = false;
  mock.query.data = [];
  rerender(<LossReasonSettings />);
  expect(screen.getByText("Nenhum motivo de perda cadastrado.")).toBeInTheDocument();
});
