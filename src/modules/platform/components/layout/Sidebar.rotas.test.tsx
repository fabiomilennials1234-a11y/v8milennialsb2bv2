import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { Gauge, GitBranch, Zap } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import type { NavNode } from "@/modules/platform/lib/navigation-model";
import { Sidebar } from "./Sidebar";

/**
 * A lateral montada COMO EM PRODUÇÃO: dentro do elemento da rota
 * (`Route > LayoutWrapper > MainLayout > Sidebar`), que desmonta a cada troca
 * de tela.
 *
 * Era aqui que o grupo "Turbo" morria: `/turbo` é um `<Navigate>` nu em
 * `App.tsx`, e navegar pra lá zerava o estado de expansão — Copilot ficava
 * inalcançável. No trilho do V5 o grupo não existe mais: Copilot e Automações
 * são portas diretas e nenhuma porta aponta para `/turbo`. Este arquivo trava
 * isso na montagem real.
 */

vi.mock("./SidebarMasterLinks", () => ({ SidebarMasterLinks: () => <div /> }));
vi.mock("./SidebarUserMenu", () => ({ SidebarUserMenu: () => <div /> }));
vi.mock("@/shared/components/UpgradeModal", () => ({ UpgradeModal: () => <div /> }));
vi.mock("@/modules/pipelines", () => ({ usePrefetchPipes: () => vi.fn() }));
vi.mock("@/modules/identity", () => ({
  useMasterAuth: () => ({ isMaster: false, isOutbounder: false }),
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

vi.mock("@/modules/platform/hooks/useNavigationModel", async () => {
  const { useLocation } = await import("react-router-dom");
  return {
    useNavigationModel: (): NavigationModel => {
      const { pathname } = useLocation();
      return {
        primary: [
          node("Comando", "/dashboard"),
          node("Funis", "/funis", GitBranch, [node("Vendas", "/funil/vendas")]),
          { ...node("Turbo", "/turbo", Zap, [node("Copilot", "/copilot"), node("Automações", "/automacoes")]), expandOnly: true },
        ],
        pitstopGroups: [],
        agenda: null,
        pitstop: null,
        isOutboundMember: false,
        isLocked: () => false,
        featureKeyFor: () => undefined,
        canViewRoute: () => true,
        isActive: (path: string) => pathname.startsWith(path),
        isPitstopRoute: false,
      };
    },
  };
});

function Tela({ nome }: { nome: string }) {
  return (
    <>
      <Sidebar />
      <h1>{nome}</h1>
    </>
  );
}

function renderApp(inicio = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[inicio]}>
      <TooltipProvider>
        <Routes>
          <Route path="/dashboard" element={<Tela nome="Comando" />} />
          <Route path="/funis" element={<Tela nome="Funis" />} />
          <Route path="/copilot" element={<Tela nome="Copilot" />} />
          <Route path="/automacoes" element={<Tela nome="Automações" />} />
          <Route path="/turbo" element={<Navigate to="/copilot" replace />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("Sidebar montada como em produção", () => {
  it("nenhuma porta aponta para /turbo", () => {
    renderApp();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/turbo");
  });

  it("Copilot é alcançável num clique, e a porta segue acesa na tela dele", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("link", { name: "Copilot" }));
    expect(screen.getByRole("heading", { name: "Copilot" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Copilot" })).toHaveClass("bg-sidebar-accent");
  });

  it("Automações também, sem passar por grupo", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("link", { name: "Automações" }));
    expect(screen.getByRole("heading", { name: "Automações" })).toBeInTheDocument();
  });

  it("CONTROLE: Funis continua navegando (sem funil padrão, para o hub)", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("link", { name: "Funis" }));
    expect(screen.getByRole("heading", { name: "Funis" })).toBeInTheDocument();
  });
});
