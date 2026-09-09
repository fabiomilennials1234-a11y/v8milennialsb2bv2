import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { GitBranch, Gauge, Zap } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import type { NavNode } from "@/modules/platform/lib/navigation-model";
import { Sidebar } from "./Sidebar";

/**
 * O `Sidebar.test.tsx` monta `<Sidebar/>` SOLTO num `MemoryRouter` sem
 * `<Routes>`. Nessa montagem o componente nunca é desmontado ao navegar, então
 * o estado `expanded` sobrevive a qualquer coisa e o bug do Turbo é invisível.
 *
 * Em produção a lateral mora DENTRO do elemento da rota
 * (`Route > ProtectedRoute > LayoutWrapper > MainLayout > Sidebar`), e a rota
 * `/turbo` de `App.tsx` é um `<Navigate>` NU — sem `LayoutWrapper`. Ir pra lá
 * desmontava a árvore inteira do layout e zerava o `useState` da lateral.
 *
 * Este arquivo monta como produção monta. É o que prova o conserto.
 *
 * LIMITAÇÃO CONHECIDA, deixada de fora de propósito: chegar em /copilot por
 * link direto, bookmark ou paleta (Cmd+K) ainda mostra o Turbo aceso com o
 * grupo FECHADO — a expansão é `useState` e não deriva da rota ativa. Conserto
 * seria fazer o grupo nascer aberto quando `isActive`, o que também mudaria o
 * Funis; ficou como assunto separado.
 */

vi.mock("./OrgSwitcher", () => ({ OrgSwitcher: () => <div /> }));
vi.mock("./SidebarMasterLinks", () => ({ SidebarMasterLinks: () => <div /> }));
vi.mock("./SidebarUserMenu", () => ({ SidebarUserMenu: () => <div /> }));
vi.mock("@/modules/platform/components/notifications/AlertsDropdown", () => ({
  AlertsDropdown: () => <div />,
}));
vi.mock("@/shared/components/UpgradeModal", () => ({ UpgradeModal: () => <div /> }));
vi.mock("@/modules/pipelines", () => ({ usePrefetchPipes: () => vi.fn() }));

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

const TURBO: NavNode = {
  label: "Turbo",
  icon: Zap,
  path: "/turbo",
  expandOnly: true,
  children: [node("Copilot", "/copilot"), node("Automações", "/automacoes")],
};

const PRIMARY: NavNode[] = [
  node("Comando", "/dashboard"),
  node("Funis", "/funis", GitBranch, [node("WhatsApp", "/pipe-whatsapp")]),
  TURBO,
];

const TURBO_PATHS = ["/turbo", "/copilot", "/automacoes"];

function makeModel(pathname: string): NavigationModel {
  return {
    primary: PRIMARY,
    pitstopGroups: [],
    agenda: null,
    pitstop: null,
    isOutboundMember: false,
    isLocked: () => false,
    featureKeyFor: () => undefined,
    canViewRoute: () => true,
    // Espelha `isRouteActive`: Turbo acende a partir dos filhos.
    isActive: (path) =>
      path === "/turbo"
        ? TURBO_PATHS.some((p) => pathname.startsWith(p))
        : pathname.startsWith(path),
    isPitstopRoute: false,
  };
}

/** Espelha `LayoutWrapper > MainLayout`: a lateral é filha do elemento da rota. */
function Layout({ nome }: { nome: string }) {
  return (
    <TooltipProvider>
      <Sidebar />
      <main>{nome}</main>
    </TooltipProvider>
  );
}

/**
 * O modelo é recalculado a cada render a partir do pathname real, como o hook
 * de verdade faz — senão `isActive` congela no valor da montagem.
 */
function Harness() {
  return (
    <Routes>
      <Route path="/dashboard" element={<Rota nome="dashboard" />} />
      <Route path="/funis" element={<Rota nome="funis" />} />
      <Route path="/pipe-whatsapp" element={<Rota nome="pipe-whatsapp" />} />
      <Route path="/automacoes" element={<Rota nome="automacoes" />} />
      <Route path="/copilot" element={<Rota nome="copilot" />} />
      {/* App.tsx:337-340 — sem ProtectedRoute, sem LayoutWrapper. */}
      <Route path="/turbo" element={<Navigate to="/automacoes" replace />} />
    </Routes>
  );
}

function Rota({ nome }: { nome: string }) {
  modelRef.current = makeModel(`/${nome}`);
  return <Layout nome={nome} />;
}

function renderApp(inicial = "/dashboard") {
  modelRef.current = makeModel(inicial);
  return render(
    <MemoryRouter initialEntries={[inicial]}>
      <Harness />
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());

describe("Sidebar montada como em produção", () => {
  it("CONTROLE: Funis tem tela-índice, então continua navegando e expandindo", async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.queryByText("WhatsApp")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Funis/ }));

    expect(screen.getByText("funis")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
  });

  it("Turbo não navega — é grupo, não tela", async () => {
    const user = userEvent.setup();
    renderApp();

    const turbo = screen.getByRole("button", { name: /Turbo/ });
    expect(screen.queryByRole("link", { name: /Turbo/ })).not.toBeInTheDocument();

    await user.click(turbo);

    // Continua no dashboard: o clique abriu o grupo, não teleportou.
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });

  it("clicar em Turbo revela Copilot e Automações", async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.queryByText("Copilot")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Turbo/ }));

    expect(screen.getByText("Copilot")).toBeInTheDocument();
    expect(screen.getByText("Automações")).toBeInTheDocument();
  });

  it("dá pra chegar no Copilot pela lateral, e o grupo segue aberto lá", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: /Turbo/ }));
    await user.click(screen.getByText("Copilot"));

    expect(screen.getByText("copilot")).toBeInTheDocument();
    // /copilot é tela com LayoutWrapper, igual à de origem: mesmo tipo no
    // mesmo slot, a lateral não remonta e o grupo continua aberto.
    expect(screen.getByText("Automações")).toBeInTheDocument();
  });

  it("segundo clique fecha o grupo", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: /Turbo/ }));
    expect(screen.getByText("Copilot")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Turbo/ }));
    expect(screen.queryByText("Copilot")).not.toBeInTheDocument();
  });

  it("com a lateral recolhida, clicar em Turbo abre a lateral e o grupo", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "Recolher menu" }));
    expect(screen.queryByText("Turbo")).not.toBeInTheDocument();

    // Recolhida o rótulo some; o alvo continua nomeado pelo tooltip.
    await user.click(screen.getAllByRole("button", { name: /Turbo/ })[0]);

    expect(screen.getByText("Copilot")).toBeInTheDocument();
  });
});
