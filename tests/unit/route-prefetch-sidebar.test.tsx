import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Gauge, GitBranch, Zap } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import type { NavNode } from "@/modules/platform/lib/navigation-model";

const preCarregarRota = vi.fn();
vi.mock("@/core/route-prefetch", () => ({ preCarregarRota: (p: string) => preCarregarRota(p) }));

const aquecer = vi.fn();
vi.mock("@/modules/pipelines", () => ({ usePrefetchPipes: () => aquecer }));
vi.mock("@/modules/platform/hooks/useVisaoMeuTodos", () => ({
  useVisaoMeuTodos: () => ({ disponivel: true, visao: "meu", setVisao: vi.fn(), donoForcado: "tm-1", pronto: true }),
}));
vi.mock("@/modules/platform/hooks/useFunilEntryPath", () => ({
  useFunilEntryPath: () => ({ path: "/funil/vendas", restored: true }),
}));
vi.mock("@/modules/platform/components/layout/SidebarMasterLinks", () => ({ SidebarMasterLinks: () => <div /> }));
vi.mock("@/modules/platform/components/layout/SidebarUserMenu", () => ({ SidebarUserMenu: () => <div /> }));
vi.mock("@/shared/components/UpgradeModal", () => ({ UpgradeModal: () => <div /> }));
vi.mock("@/modules/identity", () => ({
  useMasterAuth: () => ({ isMaster: false, isOutbounder: false }),
  useAuth: () => ({ user: { id: "user-1" } }),
  useOrganization: () => ({ organizationId: "org-1" }),
  useOrganizationSettings: () => ({ settings: null }),
}));
vi.mock("@/modules/copilot", () => ({
  useOraculoBriefing: () => ({ briefing: null, isLoading: false, open: vi.fn(), isOpening: false }),
}));

const node = (label: string, path: string, icon = Gauge, children?: NavNode[]): NavNode => ({
  label,
  icon,
  path,
  ...(children ? { children } : {}),
});

let trancado = new Set<string>();
vi.mock("@/modules/platform/hooks/useNavigationModel", () => ({
  useNavigationModel: (): NavigationModel => ({
    primary: [
      node("Comando", "/dashboard"),
      node("Chat", "/chat-whatsapp", Zap),
      node("Funis", "/funis", GitBranch, [node("Vendas", "/funil/vendas")]),
    ],
    pitstopGroups: [],
    agenda: null,
    pitstop: null,
    isOutboundMember: false,
    isLocked: (p: string) => trancado.has(p),
    featureKeyFor: () => undefined,
    canViewRoute: () => true,
    isActive: () => false,
    isPitstopRoute: false,
  }),
}));

import { Sidebar } from "@/modules/platform/components/layout/Sidebar";

function montar() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("Sidebar — pré-carregamento na intenção", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    preCarregarRota.mockReset();
    aquecer.mockReset();
    trancado = new Set();
  });
  afterEach(() => vi.useRealTimers());

  it("80 ms sobre o item pré-carrega o chunk da rota", () => {
    montar();
    fireEvent.mouseEnter(screen.getByRole("link", { name: "Chat" }));
    act(() => void vi.advanceTimersByTime(79));
    expect(preCarregarRota).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(preCarregarRota).toHaveBeenCalledWith("/chat-whatsapp");
  });

  it("passar direto não pré-carrega", () => {
    montar();
    const chat = screen.getByRole("link", { name: "Chat" });
    fireEvent.mouseEnter(chat);
    act(() => void vi.advanceTimersByTime(40));
    fireEvent.mouseLeave(chat);
    act(() => void vi.advanceTimersByTime(500));
    expect(preCarregarRota).not.toHaveBeenCalled();
  });

  it("foco de teclado também pré-carrega", () => {
    montar();
    fireEvent.focus(screen.getByRole("link", { name: "Comando" }));
    act(() => void vi.advanceTimersByTime(80));
    expect(preCarregarRota).toHaveBeenCalledWith("/dashboard");
  });

  it("Funis aquece o último funil com a visão da pessoa (mesma chave da tela)", () => {
    montar();
    fireEvent.mouseEnter(screen.getByRole("link", { name: "Funis" }));
    act(() => void vi.advanceTimersByTime(80));
    expect(preCarregarRota).toHaveBeenCalledWith("/funil/vendas");
    expect(aquecer).toHaveBeenCalledWith({ slug: "vendas", donoForcado: "tm-1" });
  });

  it("toque não pré-carrega", () => {
    montar();
    const chat = screen.getByRole("link", { name: "Chat" });
    fireEvent.touchStart(chat);
    fireEvent.mouseEnter(chat);
    act(() => void vi.advanceTimersByTime(500));
    expect(preCarregarRota).not.toHaveBeenCalled();
  });

  it("item trancado (upgrade) não pré-carrega", () => {
    trancado = new Set(["/chat-whatsapp"]);
    montar();
    const chat = screen.getByRole("button", { name: /Chat/ });
    fireEvent.mouseEnter(chat);
    act(() => void vi.advanceTimersByTime(500));
    expect(preCarregarRota).not.toHaveBeenCalled();
  });
});
