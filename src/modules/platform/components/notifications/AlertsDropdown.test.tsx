import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AlertsDropdown } from "./AlertsDropdown";

const mocks = vi.hoisted(() => ({
  salvar: vi.fn(), tocar: vi.fn(), success: vi.fn(), error: vi.fn(), marcarComoLido: vi.fn(), navigate: vi.fn(),
  visao: { disponivel: false, visao: "meu" as "meu" | "todos", setVisao: vi.fn(), donoForcado: null },
  visaoGeral: vi.fn(),
}));
vi.mock("@/shared/errors", () => ({ notifyError: mocks.error }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, info: vi.fn() } }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const MEU_AVISO = {
  id: "a-meu", organization_id: "org-1", user_id: "u-1", type: "lead_new", title: "Meu aviso",
  description: null, link: null, lead_id: null, entity_id: null, group_key: null, event_count: 1,
  last_event_at: new Date().toISOString(), created_at: new Date().toISOString(), read_at: null,
};
vi.mock("../../hooks/useAvisos", () => ({
  useAvisos: () => ({ avisos: [MEU_AVISO], naoLidos: 1, marcarComoLido: mocks.marcarComoLido, marcarTodosComoLidos: vi.fn() }),
}));
vi.mock("../../hooks/useVisaoMeuTodos", () => ({ useVisaoMeuTodos: () => mocks.visao }));
vi.mock("../../hooks/useAvisosVisaoGeral", () => ({ useAvisosVisaoGeral: (o: { enabled: boolean }) => mocks.visaoGeral(o) }));
vi.mock("../../hooks/useFeatureFlag", () => ({ useFeatureFlag: () => ({ enabled: false, isLoading: false }) }));
vi.mock("../../hooks/usePreferenciasDeAviso", () => ({ usePreferenciasDeAviso: () => ({
  preferencias: { sound_enabled: false, volume: 55 }, salvar: mocks.salvar, carregando: false, salvando: false,
}) }));
vi.mock("../../lib/motor-de-som", () => ({ motorDeSom: { tocar: mocks.tocar, destravar: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.salvar.mockResolvedValue(undefined);
  mocks.tocar.mockResolvedValue(true);
  mocks.visao = { disponivel: false, visao: "meu", setVisao: vi.fn(), donoForcado: null };
  mocks.visaoGeral.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
});
afterEach(cleanup);

it("ativar som inicia áudio no clique e confirma a preferência salva", async () => {
  render(<AlertsDropdown />);
  fireEvent.click(screen.getByRole("button", { name: "Ativar som das notificações" }));
  expect(mocks.tocar).toHaveBeenCalledWith("sistema", 55);
  expect(mocks.tocar.mock.invocationCallOrder[0]).toBeLessThan(mocks.salvar.mock.invocationCallOrder[0]);
  expect(mocks.salvar).toHaveBeenCalledWith({ sound_enabled: true });
  await waitFor(() => expect(mocks.success).toHaveBeenCalled());
});

it("falha ao salvar informa o usuário em vez de rejeitar silenciosamente", async () => {
  mocks.salvar.mockRejectedValue(new Error("write denied")); render(<AlertsDropdown />);
  fireEvent.click(screen.getByRole("button", { name: "Ativar som das notificações" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.success).not.toHaveBeenCalled();
});

it("sem a visão disponível: nenhum controle Meus · Todos, e a lista é a do usuário", () => {
  render(<AlertsDropdown />);
  expect(screen.queryByRole("radiogroup", { name: "Visão das notificações" })).toBeNull();
  expect(screen.getByText("Meu aviso")).toBeTruthy();
  expect(mocks.visaoGeral).toHaveBeenCalledWith({ enabled: false });
});

it("admin em 'Todos': lista da org com destinatários, só leitura (não marca lido nem oferece marcar todas)", async () => {
  mocks.visao = { disponivel: true, visao: "todos", setVisao: vi.fn(), donoForcado: null };
  mocks.visaoGeral.mockReturnValue({
    data: [{ ...MEU_AVISO, id: "a-org", title: "Aviso da equipe", link: "/leads?lead=l-1", user_id: "u-2", destinatarios: ["Ana", "Bruno"] }],
    isLoading: false, isError: false, refetch: vi.fn(),
  });
  render(<AlertsDropdown />);
  expect(screen.getByRole("radiogroup", { name: "Visão das notificações" })).toBeTruthy();
  expect(screen.queryByText("Meu aviso")).toBeNull();
  expect(screen.getByText("Ana, Bruno")).toBeTruthy();
  expect(screen.queryByText("Marcar todas como lidas")).toBeNull();
  fireEvent.click(screen.getByText("Aviso da equipe"));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  expect(mocks.marcarComoLido).not.toHaveBeenCalled();
});

it("admin em 'Todos' com falha na leitura: diz que falhou e oferece tentar de novo", () => {
  const refetch = vi.fn();
  mocks.visao = { disponivel: true, visao: "todos", setVisao: vi.fn(), donoForcado: null };
  mocks.visaoGeral.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
  render(<AlertsDropdown />);
  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(refetch).toHaveBeenCalled();
});
