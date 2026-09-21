import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), gestor: vi.fn(), content: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useAuth: mocks.auth, useGestor: mocks.gestor }));
import { SupportAccess } from "@/modules/platform/components/support/SupportAccess";

function SupportContent() {
  mocks.content();
  return <button>Suporte</button>;
}

describe("SupportAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockReturnValue({ user: { id: "user" } });
    mocks.gestor.mockReturnValue({ isGestor: false, isLoading: false, error: null });
  });
  it("mantém suporte para usuários comuns", () => {
    render(<SupportAccess><SupportContent /></SupportAccess>);
    expect(screen.getByRole("button", { name: "Suporte" })).toBeInTheDocument();
  });
  it.each([
    { isGestor: true, isLoading: false, error: null },
    { isGestor: false, isLoading: true, error: null },
    { isGestor: false, isLoading: false, error: new Error("indisponível") },
  ])("não monta suporte ou suas consultas para gestor ou identidade pendente", state => {
    mocks.gestor.mockReturnValue(state);
    render(<SupportAccess><SupportContent /></SupportAccess>);
    expect(mocks.content).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("não mostra suporte sem login", () => {
    mocks.auth.mockReturnValue({ user: null });
    render(<SupportAccess><SupportContent /></SupportAccess>);
    expect(mocks.content).not.toHaveBeenCalled();
  });
  it("desmonta um painel aberto quando a identidade muda para gestor", () => {
    const { rerender } = render(<SupportAccess><SupportContent /></SupportAccess>);
    mocks.gestor.mockReturnValue({ isGestor: true, isLoading: false, error: null });
    rerender(<SupportAccess><SupportContent /></SupportAccess>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
