import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Gauge } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import { Sidebar } from "./Sidebar";

/**
 * O Oráculo no trilho do V5.
 *
 * Antes era um "slot" no meio da lateral larga, com a manchete do briefing à
 * vista e um painel por cima da tela. No trilho de 76 px ele é um ícone: a
 * manchete vai para o nome acessível/tooltip, o briefing novo vira um ponto
 * de ouro, e o clique leva à PÁGINA do Oráculo — já na conversa do briefing,
 * quando há um.
 */

vi.mock("./SidebarMasterLinks", () => ({ SidebarMasterLinks: () => <div /> }));
vi.mock("./SidebarUserMenu", () => ({ SidebarUserMenu: () => <div /> }));
vi.mock("@/shared/components/UpgradeModal", () => ({ UpgradeModal: () => <div /> }));
vi.mock("@/modules/pipelines", () => ({ usePrefetchPipes: () => vi.fn() }));
vi.mock("@/modules/identity", () => ({
  useMasterAuth: () => ({ isMaster: false, isOutbounder: false }),
  useOrganizationSettings: () => ({ settings: null }),
}));

const briefingRef: { current: null | { id: string; headline: string; status: string } } = { current: null };
const openBriefing = vi.fn(async () => ({ conversa_id: "conversa-briefing" }));
vi.mock("@/modules/copilot", () => ({
  useOraculoBriefing: () => ({
    briefing: briefingRef.current,
    isLoading: false,
    isOpening: false,
    open: openBriefing,
  }),
}));

vi.mock("@/modules/platform/hooks/useNavigationModel", () => ({
  useNavigationModel: (): NavigationModel => ({
    primary: [{ label: "Comando", icon: Gauge, path: "/dashboard" }],
    pitstopGroups: [],
    agenda: null,
    pitstop: null,
    isOutboundMember: false,
    isLocked: () => false,
    featureKeyFor: () => undefined,
    canViewRoute: () => true,
    isActive: () => false,
    isPitstopRoute: false,
  }),
}));

function Onde() {
  const l = useLocation();
  return <p data-testid="onde">{l.pathname + l.search}</p>;
}

function renderSidebar() {
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
  briefingRef.current = null;
  openBriefing.mockClear();
});

describe("Sidebar — Oráculo no trilho", () => {
  it("sem briefing, é a porta da página do Oráculo", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Oráculo" }));
    expect(screen.getByTestId("onde")).toHaveTextContent("/oraculo");
    expect(openBriefing).not.toHaveBeenCalled();
  });

  it("a manchete do briefing viaja no nome do ícone", () => {
    briefingRef.current = { id: "b1", headline: "3 propostas paradas há 4 dias", status: "seen" };
    renderSidebar();
    expect(screen.getByRole("button", { name: "Oráculo — 3 propostas paradas há 4 dias" })).toBeInTheDocument();
  });

  it("com briefing, abre a página já na conversa do briefing", async () => {
    const user = userEvent.setup();
    briefingRef.current = { id: "b1", headline: "Gargalo na proposta", status: "new" };
    renderSidebar();
    await user.click(screen.getByRole("button", { name: /Oráculo/ }));
    expect(openBriefing).toHaveBeenCalledWith("b1");
    await waitFor(() => expect(screen.getByTestId("onde")).toHaveTextContent("/oraculo?conversa=conversa-briefing"));
  });

  it("se abrir o briefing falhar, ainda leva à página — sem rejeição solta", async () => {
    const user = userEvent.setup();
    openBriefing.mockRejectedValueOnce(new Error("rede"));
    briefingRef.current = { id: "b1", headline: "Gargalo", status: "new" };
    renderSidebar();
    await user.click(screen.getByRole("button", { name: /Oráculo/ }));
    await waitFor(() => expect(screen.getByTestId("onde")).toHaveTextContent("/oraculo"));
  });
});
