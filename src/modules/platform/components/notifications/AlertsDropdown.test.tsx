import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AlertsDropdown } from "./AlertsDropdown";

const mocks = vi.hoisted(() => ({ salvar: vi.fn(), tocar: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, info: vi.fn() } }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../hooks/useAvisos", () => ({ useAvisos: () => ({ avisos: [], naoLidos: 0 }) }));
vi.mock("../../hooks/usePreferenciasDeAviso", () => ({ usePreferenciasDeAviso: () => ({
  preferencias: { sound_enabled: false, volume: 55 }, salvar: mocks.salvar, carregando: false, salvando: false,
}) }));
vi.mock("../../lib/motor-de-som", () => ({ motorDeSom: { tocar: mocks.tocar, destravar: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); mocks.salvar.mockResolvedValue(undefined); mocks.tocar.mockResolvedValue(true); });
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
