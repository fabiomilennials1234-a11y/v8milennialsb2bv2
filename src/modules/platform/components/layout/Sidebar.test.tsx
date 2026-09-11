import {
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Gauge, GitBranch, Send, Settings, Trophy, Wallet, Zap } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SIDEBAR_FEATURE_MAP } from "@/modules/platform/lib/feature-registry";
import type { NavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import type { NavNode, PitstopGroup } from "@/modules/platform/lib/navigation-model";
import { Sidebar } from "./Sidebar";

/**
 * O que este teste cobre é a FORMA da lateral — recolher, expandir, abrir o
 * Pitstop. Quem decide visibilidade é `useNavigationModel`, testado à parte em
 * `navigation-filters.test.ts`; por isso aqui ele é dublê.
 */

const upgradeSpy = vi.fn();

vi.mock("./OrgSwitcher", () => ({ OrgSwitcher: () => <div data-testid="org-switcher" /> }));
// Mesmo motivo do dublê acima: os atalhos de master leem a sessão
// (`useMasterAuth` → `useAuth`), e este teste não monta `AuthProvider` porque o
// que ele cobre é a FORMA da lateral, não quem enxerga o quê.
vi.mock("./SidebarMasterLinks", () => ({
  SidebarMasterLinks: () => <div data-testid="master-links" />,
}));
vi.mock("./SidebarUserMenu", () => ({ SidebarUserMenu: () => <div data-testid="user-menu" /> }));
// O dublê HONRA `rotulo` porque o real também honra
// (`AlertsDropdown.tsx`: `{rotulo && <span>{rotulo}</span>}`).
//
// Ele ignorava a prop, e isso quebrou a asserção de "Notificações" no rodapé
// no dia em que o Sidebar parou de renderizar a palavra num <span> inerte e
// passou a entregá-la ao componente. O teste ficou vermelho na main sem que
// nada no PRODUTO tivesse regredido: dublê mais frouxo que o real transforma
// refatoração correta em falha.
vi.mock("@/modules/platform/components/notifications/AlertsDropdown", () => ({
  AlertsDropdown: ({ rotulo }: { rotulo?: string }) => (
    <div data-testid="alerts">{rotulo}</div>
  ),
}));
vi.mock("@/shared/components/UpgradeModal", () => ({
  UpgradeModal: ({ featureKey }: { featureKey: string }) => {
    upgradeSpy(featureKey);
    return <div data-testid="upgrade-modal">{featureKey}</div>;
  },
}));
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

const PRIMARY: NavNode[] = [
  node("Comando", "/dashboard"),
  node("Chat", "/chat-whatsapp", Zap),
  node("Disparos", "/disparos", Send),
  node("Funis", "/funis", GitBranch, [
    node("WhatsApp", "/pipe-whatsapp"),
    node("Propostas", "/pipe-propostas"),
  ]),
  node("Carteira", "/upsell", Wallet),
  node("Turbo", "/turbo", Zap, [node("Copilot", "/copilot")]),
];

const PITSTOP: PitstopGroup[] = [
  {
    id: "gestao",
    title: "Gestão",
    hint: "Consulta semanal",
    items: [node("Ranking", "/performance", Trophy)],
  },
  {
    id: "rotas",
    title: "Rotas",
    hint: "O que vivia no Mais",
    items: [node("Comissões", "/comissoes")],
  },
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

function renderSidebar(model: NavigationModel = makeModel()) {
  modelRef.current = model;
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  upgradeSpy.mockClear();
  window.localStorage.clear();
});

describe("Sidebar", () => {
  it("mostra as seis portas e os quatro itens de rodapé", () => {
    renderSidebar();

    for (const label of ["Comando", "Chat", "Disparos", "Funis", "Carteira", "Turbo"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
    // A Agenda é BOTÃO, não link: ela abre painel sobreposto por cima da tela
    // atual em vez de navegar. A rota `/agenda` continua existindo para o
    // celular e para link direto — ver `AgendaPanel`.
    expect(screen.getByRole("button", { name: /Agenda/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Agenda/ })).not.toBeInTheDocument();
    expect(screen.getByText("Notificações")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ajuda/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pitstop/ })).toBeInTheDocument();
  });

  it("não mostra o antigo menu Mais", () => {
    renderSidebar();
    expect(screen.queryByText("Mais")).not.toBeInTheDocument();
  });

  it("recolhe e esconde os rótulos, mantendo os alvos clicáveis", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByText("Comando")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Recolher menu" }));

    expect(screen.queryByText("Comando")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expandir menu" })).toBeInTheDocument();
    // O link continua lá — só perdeu o rótulo visível.
    expect(document.querySelector('a[href="/dashboard"]')).toBeInTheDocument();
  });

  it("recolhe o logotipo com a lateral e mantém o hexágono", async () => {
    const user = userEvent.setup();
    renderSidebar();

    // Quem carrega o nome acessível é o hexágono; o logotipo é decorativo e
    // some da árvore acessível de qualquer jeito.
    expect(screen.getByAltText("Torque")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-wordmark")).toHaveAttribute("data-collapsed", "false");

    await user.click(screen.getByRole("button", { name: "Recolher menu" }));

    expect(screen.getByAltText("Torque")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-wordmark")).toHaveAttribute("data-collapsed", "true");
  });

  it("expande Funis e revela os filhos", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.queryByText("WhatsApp")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Funis/ }));

    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Propostas")).toBeInTheDocument();
  });

  it("abre o Pitstop com os grupos e NÃO fecha ao navegar dentro dele", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: /Pitstop/ }));

    const painel = screen.getByRole("complementary", { name: "Pitstop" });
    expect(within(painel).getByText("Gestão")).toBeInTheDocument();
    expect(within(painel).getByText("Ranking")).toBeInTheDocument();
    expect(within(painel).getByText("Comissões")).toBeInTheDocument();

    // Este é o ponto do redesenho: escolher um item mantém o painel aberto.
    await user.click(within(painel).getByText("Ranking"));
    expect(screen.getByRole("complementary", { name: "Pitstop" })).toBeInTheDocument();
  });

  it("fecha o Pitstop pelo botão de fechar", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: /Pitstop/ }));
    await user.click(screen.getByRole("button", { name: "Fechar Pitstop" }));

    expect(screen.queryByRole("complementary", { name: "Pitstop" })).not.toBeInTheDocument();
  });

  it("abre o Pitstop sozinho quando a rota atual mora dentro dele", () => {
    renderSidebar(makeModel({ isPitstopRoute: true }));
    expect(screen.getByRole("complementary", { name: "Pitstop" })).toBeInTheDocument();
  });

  it("item trancado por plano abre o upgrade em vez de navegar", async () => {
    const user = userEvent.setup();
    renderSidebar(
      makeModel({
        isLocked: (path) => path === "/turbo",
        // O mapa REAL, não um dublê. A versão anterior devolvia "copilot" na
        // mão para "/turbo" — chave que o catálogo não tinha. O teste passava
        // verde enquanto em produção `openUpgrade` engolia o clique e o modal
        // nunca abria. Fixture que inventa dado não é guarda, é enfeite.
        featureKeyFor: (path) => SIDEBAR_FEATURE_MAP[path],
      }),
    );

    const turbo = screen.getByRole("button", { name: /Turbo/ });
    expect(turbo.tagName).toBe("BUTTON"); // não é link: não navega
    await user.click(turbo);

    expect(screen.getByTestId("upgrade-modal")).toBeInTheDocument();
    expect(upgradeSpy).toHaveBeenCalledWith("copilot");
  });

  it("sem grupos de Pitstop o gatilho some — painel vazio é pior que painel nenhum", () => {
    renderSidebar(makeModel({ pitstopGroups: [] }));
    expect(screen.queryByRole("button", { name: /Pitstop/ })).not.toBeInTheDocument();
  });

  it("esconde a Agenda quando a permissão nega", () => {
    renderSidebar(makeModel({ agenda: null }));
    expect(screen.queryByRole("button", { name: /Agenda/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Agenda/ })).not.toBeInTheDocument();
  });

  it("o botão da Agenda abre e fecha o painel, sem navegar", async () => {
    const user = userEvent.setup();
    renderSidebar();

    const botao = screen.getByRole("button", { name: /Agenda/ });
    expect(botao).toHaveAttribute("aria-expanded", "false");

    await user.click(botao);
    expect(screen.getByRole("button", { name: /Agenda/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // O painel é `React.lazy`: o que se vê no primeiro paint é o fallback, e
    // resolver o módulo dinâmico é assíncrono. O 1s padrão do `findBy*` é
    // apertado na suíte inteira em paralelo — este teste entrou como INSTÁVEL
    // no `test:ratchet` com o teto default.
    expect(
      await screen.findByLabelText("Atividades", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Agenda/ }));
    expect(screen.getByRole("button", { name: /Agenda/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // `AnimatePresence` mantém o painel montado durante a saída — esperar a
    // remoção, e não afirmar ausência no mesmo tick.
    await waitForElementToBeRemoved(() => screen.queryByLabelText("Atividades"));
  });
});
