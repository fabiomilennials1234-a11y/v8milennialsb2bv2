import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Gauge, GitBranch, Send, Settings, Trophy, Wallet, Zap } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import type { NavNode, PitstopGroup } from "@/modules/platform/lib/navigation-model";
import { Sidebar } from "./Sidebar";

/**
 * O slot do Oráculo dentro da lateral MONTADA.
 *
 * `slot-do-oraculo.test.ts` prova a aritmética do degrau e
 * `useDegrauDoSlot.test.tsx` prova que a medição sai da lateral e não da
 * janela. Nenhum dos dois prova que os elementos medidos são o topo, o rodapé e
 * a navegação REAIS — nos dois as referências são passadas à mão. É o que este
 * arquivo cobre: se alguém pendurar a referência no elemento errado, os outros
 * seguem verdes e este fica vermelho.
 *
 * jsdom não faz layout, então `offsetHeight` nasce 0 em tudo. O harness abaixo
 * devolve altura para os elementos que a lateral marcou com `data-medida`, que
 * são exatamente os que o hook lê.
 */

vi.mock("./OrgSwitcher", () => ({ OrgSwitcher: () => <div data-testid="org-switcher" /> }));
vi.mock("./SidebarMasterLinks", () => ({
  SidebarMasterLinks: () => <div data-testid="master-links" />,
}));
vi.mock("./SidebarUserMenu", () => ({ SidebarUserMenu: () => <div data-testid="user-menu" /> }));
vi.mock("@/modules/platform/components/notifications/AlertsDropdown", () => ({
  AlertsDropdown: () => <div data-testid="alerts" />,
}));
vi.mock("@/shared/components/UpgradeModal", () => ({
  UpgradeModal: () => <div data-testid="upgrade-modal" />,
}));
vi.mock("@/modules/pipelines", () => ({ usePrefetchPipes: () => vi.fn() }));
// A conversa é dublada: o que importa aqui é o painel MONTÁ-LA. O conteúdo
// dela tem teste próprio em `OraculoConversa.test.tsx`, e o de verdade puxaria
// sessão e rede.
vi.mock("@/modules/copilot/components/oraculo/OraculoConversa", () => ({
  OraculoConversa: () => <div data-testid="conversa-do-oraculo" />,
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
  node("Funis", "/funis", GitBranch),
  node("Carteira", "/upsell", Wallet),
  node("Turbo", "/turbo", Zap),
];

const PITSTOP: PitstopGroup[] = [
  { id: "gestao", title: "Gestão", hint: "", items: [node("Ranking", "/performance", Trophy)] },
];

function makeModel(): NavigationModel {
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
  };
}

/**
 * Harness de pixel: dá altura aos elementos que a lateral marcou para medição.
 * Devolver 0 para o resto é de propósito — se o hook ler um elemento não
 * marcado, a conta desanda e o teste acusa.
 */
const alturas = new Map<string, number>();
let offsetHeightOriginal: PropertyDescriptor | undefined;

function fixarAlturas(medidas: Record<string, number>) {
  alturas.clear();
  for (const [chave, valor] of Object.entries(medidas)) alturas.set(chave, valor);
}

beforeAll(() => {
  offsetHeightOriginal = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      const chave = this.getAttribute("data-medida");
      return chave ? (alturas.get(chave) ?? 0) : 0;
    },
  });
});

afterAll(() => {
  if (offsetHeightOriginal) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeightOriginal);
  }
});

beforeEach(() => {
  window.localStorage.clear();
});

function renderSidebar() {
  modelRef.current = makeModel();
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("Sidebar — slot do Oráculo", () => {
  it("a 900px de lateral, a porta do Oráculo existe — como linha, porque ainda não há briefing", () => {
    // Recorte (a): o card exige conteúdo e nenhum produtor de briefing existe
    // ainda, então o degrau alto disponível é a linha. O que importa aqui é que
    // a porta EXISTE — antes desta fatia não havia link nenhum para /oraculo.
    fixarAlturas({ lateral: 900, topo: 96, rodape: 180, nav: 320 });

    renderSidebar();

    expect(screen.getByTestId("slot-do-oraculo")).toHaveAttribute("data-degrau", "linha");
  });

  it("a 560px com menu comprido, degrada para o ícone", () => {
    // Este caso é o que acusa referência pendurada no elemento errado: se o
    // rodapé não for medido, sobram 464px em vez de 284px e o degrau vira
    // "linha". Nos testes de unidade isso passaria despercebido.
    fixarAlturas({ lateral: 560, topo: 96, rodape: 180, nav: 400 });

    renderSidebar();

    expect(screen.getByTestId("slot-do-oraculo")).toHaveAttribute("data-degrau", "icone");
  });

  it("em tela baixa demais o slot some e a navegação recupera a altura", () => {
    fixarAlturas({ lateral: 420, topo: 96, rodape: 180, nav: 400 });

    renderSidebar();

    expect(screen.queryByTestId("slot-do-oraculo")).not.toBeInTheDocument();
    // O rodapé continua montado: o slot cede espaço, nunca empurra o rodapé
    // para fora da tela.
    expect(screen.getByTestId("user-menu")).toBeInTheDocument();
  });

  it("recolher a lateral não perde o acesso: resta o ícone", async () => {
    const user = userEvent.setup();
    fixarAlturas({ lateral: 900, topo: 96, rodape: 180, nav: 320 });

    renderSidebar();
    expect(screen.getByTestId("slot-do-oraculo")).toHaveAttribute("data-degrau", "linha");

    await user.click(screen.getByRole("button", { name: "Recolher menu" }));

    expect(screen.getByTestId("slot-do-oraculo")).toHaveAttribute("data-degrau", "icone");
  });

  it("clicar abre o painel por cima e NÃO navega — a página de baixo continua a mesma", async () => {
    const user = userEvent.setup();
    fixarAlturas({ lateral: 900, topo: 96, rodape: 180, nav: 320 });

    renderSidebar();
    expect(screen.queryByTestId("painel-do-oraculo")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Oráculo/ }));

    expect(await screen.findByTestId("painel-do-oraculo")).toBeInTheDocument();
    // A lateral continua montada e clicável: com o painel aberto ainda dá para
    // ir para outra tela num clique só, mesmo contrato da Agenda.
    expect(screen.getByRole("link", { name: /Comando/ })).toBeInTheDocument();
  });

  it("o capturador de clique começa DEPOIS da lateral, e acompanha quando ela recolhe", async () => {
    // O link continuar no documento não prova que dá para clicar nele: jsdom
    // não faz layout, então uma camada por cima não removeria elemento nenhum.
    // O que prova é a borda esquerda do capturador.
    const user = userEvent.setup();
    fixarAlturas({ lateral: 900, topo: 96, rodape: 180, nav: 320 });

    renderSidebar();
    await user.click(screen.getByRole("button", { name: /Oráculo/ }));

    expect(screen.getByTestId("captura-do-oraculo").style.left).toBe("248px");

    await user.click(screen.getByRole("button", { name: "Recolher menu" }));

    expect(screen.getByTestId("captura-do-oraculo").style.left).toBe("64px");
  });

  it("fecha pelo Esc e pelo botão", async () => {
    const user = userEvent.setup();
    fixarAlturas({ lateral: 900, topo: 96, rodape: 180, nav: 320 });
    renderSidebar();

    await user.click(screen.getByRole("button", { name: /Oráculo/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("painel-do-oraculo")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Oráculo/ }));
    await user.click(screen.getByRole("button", { name: "Fechar o Oráculo" }));
    expect(screen.queryByTestId("painel-do-oraculo")).not.toBeInTheDocument();
  });

  it("o painel traz a conversa dentro, e não um atalho para outra tela", async () => {
    const user = userEvent.setup();
    fixarAlturas({ lateral: 900, topo: 96, rodape: 180, nav: 320 });
    renderSidebar();

    await user.click(screen.getByRole("button", { name: /Oráculo/ }));

    expect(await screen.findByTestId("conversa-do-oraculo")).toBeInTheDocument();
  });
});
