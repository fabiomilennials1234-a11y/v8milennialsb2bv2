import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Gauge, GitBranch, Send, Settings, Trophy, Zap } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import type { NavNode, PitstopGroup } from "@/modules/platform/lib/navigation-model";
import { Sidebar } from "./Sidebar";

/**
 * A FORMA da lateral do V5: trilho de ícones de 76 px, sem rótulo e sem
 * expandir (decisão do CTO, 02/10). Quem decide visibilidade é
 * `useNavigationModel`, testado à parte — aqui ele é dublê.
 *
 * O que este arquivo trava:
 * - toda porta tem nome acessível (ícone sem nome é adivinhação);
 * - o grupo "Turbo" virou duas portas diretas, sem clique intermediário;
 * - Funis leva ao funil padrão da org (o hub virou aba dentro da página);
 * - Agenda e Pitstop navegam para páginas — não abrem mais painel;
 * - item trancado por plano abre o upgrade em vez de navegar;
 * - o escudo do Master só existe para master.
 */

const upgradeSpy = vi.fn();
const masterRef = { current: { isMaster: false, isOutbounder: false } };
const settingsRef: { current: { default_pipeline_id?: string } | null } = { current: null };

vi.mock("./SidebarMasterLinks", () => ({
  SidebarMasterLinks: () => <div data-testid="master-links" />,
}));
vi.mock("./SidebarUserMenu", () => ({ SidebarUserMenu: () => <div data-testid="user-menu" /> }));
vi.mock("@/shared/components/UpgradeModal", () => ({
  UpgradeModal: ({ featureKey }: { featureKey: string }) => {
    upgradeSpy(featureKey);
    return <div data-testid="upgrade-modal">{featureKey}</div>;
  },
}));
vi.mock("@/modules/pipelines", () => ({ usePrefetchPipes: () => vi.fn() }));
vi.mock("@/modules/identity", () => ({
  useMasterAuth: () => masterRef.current,
  useOrganizationSettings: () => ({ settings: settingsRef.current }),
}));
vi.mock("@/modules/copilot", () => ({
  useOraculoBriefing: () => ({ briefing: null, isLoading: false, open: vi.fn(), isOpening: false }),
}));

const modelRef: { current: NavigationModel } = { current: null as never };
vi.mock("@/modules/platform/hooks/useNavigationModel", () => ({
  useNavigationModel: () => modelRef.current,
}));

const node = (label: string, path: string, icon = Gauge, children?: NavNode[]): NavNode => ({
  label,
  icon,
  path,
  ...(children ? { children } : {}),
});

const PRIMARY: NavNode[] = [
  node("Comando", "/dashboard"),
  node("Chat", "/chat-whatsapp", Zap),
  node("Disparos", "/disparos", Send),
  node("Funis", "/funis", GitBranch, [node("Funil de Vendas", "/funil/vendas")]),
  node("Leads", "/leads"),
  node("Turbo", "/turbo", Zap, [node("Copilot", "/copilot"), node("Automações", "/automacoes")]),
];

const PITSTOP: PitstopGroup[] = [
  { id: "gestao", title: "Gestão", hint: "Consulta semanal", items: [node("Ranking", "/performance", Trophy)] },
];

function makeModel(overrides: Partial<NavigationModel> = {}): NavigationModel {
  return {
    primary: PRIMARY,
    pitstopGroups: PITSTOP,
    agenda: node("Agenda", "/agenda"),
    pitstop: node("Pitstop", "/configuracoes", Settings),
    isOutboundMember: false,
    isLocked: () => false,
    featureKeyFor: () => undefined,
    canViewRoute: () => true,
    isActive: (path: string) => path === "/dashboard",
    isPitstopRoute: false,
    ...overrides,
  };
}

function Onde() {
  return <p data-testid="onde">{useLocation().pathname}</p>;
}

function renderSidebar(model: NavigationModel = makeModel()) {
  modelRef.current = model;
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <TooltipProvider>
        <Sidebar />
        <Routes>
          <Route path="*" element={<Onde />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  upgradeSpy.mockClear();
  masterRef.current = { isMaster: false, isOutbounder: false };
  settingsRef.current = null;
});

describe("Sidebar — trilho de ícones", () => {
  it("toda porta tem nome acessível, mesmo sem rótulo visível", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "Telas" });
    for (const nome of ["Comando", "Chat", "Disparos", "Funis", "Leads", "Copilot", "Automações", "Oráculo"]) {
      expect(within(nav).getByRole(nome === "Oráculo" ? "button" : "link", { name: nome })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ajuda" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pitstop" })).toBeInTheDocument();
  });

  it("não sobra rótulo visível nem botão de recolher/expandir", () => {
    renderSidebar();
    const lateral = screen.getByTestId("sidebar");
    expect(lateral).toHaveStyle({ width: "76px" });
    expect(within(lateral).queryByText("Comando")).toBeNull();
    expect(screen.queryByRole("button", { name: /recolher|expandir/i })).toBeNull();
  });

  it("Turbo virou duas portas diretas: Copilot navega no primeiro clique", async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.queryByRole("button", { name: "Turbo" })).toBeNull();
    await user.click(screen.getByRole("link", { name: "Copilot" }));
    expect(screen.getByTestId("onde")).toHaveTextContent("/copilot");
  });

  it("Funis leva ao funil padrão da org", async () => {
    const user = userEvent.setup();
    settingsRef.current = { default_pipeline_id: "f-123" };
    renderSidebar();
    await user.click(screen.getByRole("link", { name: "Funis" }));
    expect(screen.getByTestId("onde")).toHaveTextContent("/funil/f-123");
  });

  it("sem funil padrão, Funis cai no hub", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("link", { name: "Funis" }));
    expect(screen.getByTestId("onde")).toHaveTextContent("/funis");
  });

  it("Agenda e Pitstop navegam para páginas", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("link", { name: "Agenda" }));
    expect(screen.getByTestId("onde")).toHaveTextContent("/agenda");
    await user.click(screen.getByRole("link", { name: "Pitstop" }));
    expect(screen.getByTestId("onde")).toHaveTextContent("/pitstop");
  });

  it("sem grupos de Pitstop a porta some — página vazia é pior que porta nenhuma", () => {
    renderSidebar(makeModel({ pitstopGroups: [] }));
    expect(screen.queryByRole("link", { name: "Pitstop" })).toBeNull();
  });

  it("esconde a Agenda quando a permissão nega", () => {
    renderSidebar(makeModel({ agenda: null }));
    expect(screen.queryByRole("link", { name: "Agenda" })).toBeNull();
  });

  it("item trancado por plano abre o upgrade em vez de navegar", async () => {
    const user = userEvent.setup();
    renderSidebar(
      makeModel({
        isLocked: (path) => path === "/disparos",
        featureKeyFor: (path) => (path === "/disparos" ? "campaigns" : undefined) as never,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Disparos/ }));
    expect(upgradeSpy).toHaveBeenCalledWith("campaigns");
    expect(screen.getByTestId("onde")).toHaveTextContent("/dashboard");
  });

  it("o escudo do Master só aparece para master, e abre os atalhos dele", async () => {
    const { unmount } = renderSidebar();
    expect(screen.queryByRole("button", { name: "Master" })).toBeNull();
    unmount();

    const user = userEvent.setup();
    masterRef.current = { isMaster: true, isOutbounder: false };
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Master" }));
    expect(await screen.findByTestId("master-links")).toBeInTheDocument();
  });

  it("outbounder vê o mesmo escudo com o nome do painel dele", () => {
    masterRef.current = { isMaster: true, isOutbounder: true };
    renderSidebar();
    expect(screen.getByRole("button", { name: "Painel Outbound" })).toBeInTheDocument();
  });
});
