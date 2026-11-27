/**
 * Flag `agenda_so_no_comando` (Café Jurerê, 27/11): a tela Agenda sai do
 * produto e tudo que levaria a ela cai no Comando.
 *
 *   (RO) a rota `/agenda` redireciona para `/dashboard` — vale para qualquer
 *        origem (botão, paleta, favorito, push, link `/agenda` dos avisos).
 *   (NV) a porta some da lateral/gaveta (`model.agenda`), da barra do celular
 *        e da paleta de comandos (navegação e recentes).
 *   (FC) sem a flag, nada muda; enquanto a flag carrega, nada some.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Command } from "cmdk";

const h = vi.hoisted(() => ({
  flags: {} as Record<string, boolean>,
  flagsLoading: false,
  org: { organizationId: "org-1" as string | null, isLoading: false, orgType: "standard" },
  recentes: [] as string[],
}));

vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (key: string) =>
    h.flagsLoading ? { enabled: false, isLoading: true } : { enabled: h.flags[key] === true, isLoading: false },
}));
vi.mock("@/modules/identity", () => ({
  useIdentity: () => ({ isAdmin: true, isMaster: false }),
  useUserRole: () => ({ data: { role: "admin" } }),
  useFeaturePermissions: () => ({ data: {} }),
  useOrganization: () => h.org,
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: () => true }),
  useOrgFeaturesOptional: () => null,
}));
vi.mock("@/modules/communication/hooks/chat-meta/useMetaPages", () => ({ useMetaPages: () => ({ data: { pages: [] } }) }));
vi.mock("@/modules/pipelines", async () => ({
  ...(await import("@/modules/pipelines/lib/pipeline-navigation")),
  usePipelines: () => ({ data: [] }),
  funilIcon: () => () => null,
}));
vi.mock("@/modules/platform/hooks/useLeadsLabel", () => ({ useLeadsLabel: () => "Leads" }));
vi.mock("@/shared/hooks/use-viewport", () => ({ useViewport: () => ({ isMobile: true }) }));
vi.mock("@/contexts/MobileChatContext", () => ({ useMobileChatContext: () => ({ isChatThreadOpen: false }) }));
vi.mock("@/modules/platform/hooks/useFunilEntryPath", () => ({ useFunilEntryPath: () => ({ path: "/funis", restored: false }) }));
vi.mock("@/modules/platform/components/command/recentCommands", () => ({
  getRecent: () => h.recentes,
  pushRecent: vi.fn(),
}));
vi.mock("@/modules/engagement/hooks/useRecentItems", () => ({ useRecentItems: () => ({ data: [] }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark", setTheme: vi.fn() }) }));

import { AgendaRoute } from "@/modules/platform/components/AgendaRoute";
import { useNavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import { MobileBottomNav } from "@/modules/platform/components/layout/MobileBottomNav";
import { CommandGroupNavigation } from "@/modules/platform/components/command/groups/CommandGroupNavigation";
import { CommandGroupRecents } from "@/modules/platform/components/command/groups/CommandGroupRecents";

function rotaAgenda() {
  return render(
    <MemoryRouter initialEntries={["/agenda"]}>
      <Routes>
        <Route path="/agenda" element={<AgendaRoute><p>Tela Agenda</p></AgendaRoute>} />
        <Route path="/dashboard" element={<p>Comando</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.flags = {};
  h.flagsLoading = false;
  h.org = { organizationId: "org-1", isLoading: false, orgType: "standard" };
  h.recentes = [];
});

describe("(RO) rota /agenda", () => {
  it("com a flag, vai para o Comando sem montar a tela", () => {
    h.flags = { agenda_so_no_comando: true };
    rotaAgenda();
    expect(screen.getByText("Comando")).toBeInTheDocument();
    expect(screen.queryByText("Tela Agenda")).toBeNull();
  });

  it("sem a flag, a tela abre como sempre", () => {
    rotaAgenda();
    expect(screen.getByText("Tela Agenda")).toBeInTheDocument();
  });

  it("enquanto a flag carrega, espera — não mostra a Agenda para depois tirar", () => {
    h.flagsLoading = true;
    rotaAgenda();
    expect(screen.getByRole("status", { name: "Carregando" })).toBeInTheDocument();
    expect(screen.queryByText("Tela Agenda")).toBeNull();
  });

  it("sem org não há flag a esperar: a tela abre (não fica presa no spinner)", () => {
    h.flagsLoading = true;
    h.org = { organizationId: null, isLoading: false, orgType: "standard" };
    rotaAgenda();
    expect(screen.getByText("Tela Agenda")).toBeInTheDocument();
  });
});

describe("(NV) lateral e gaveta", () => {
  it("com a flag, a porta da Agenda some", () => {
    h.flags = { agenda_so_no_comando: true };
    const { result } = renderHook(() => useNavigationModel(), { wrapper: MemoryRouter });
    expect(result.current.agenda).toBeNull();
    expect(result.current.agendaOculta).toBe(true);
  });

  it("sem a flag, a porta continua", () => {
    const { result } = renderHook(() => useNavigationModel(), { wrapper: MemoryRouter });
    expect(result.current.agenda?.path).toBe("/agenda");
    expect(result.current.agendaOculta).toBe(false);
  });

  it("enquanto a flag carrega, a porta não some (nenhuma org vê piscar)", () => {
    h.flagsLoading = true;
    const { result } = renderHook(() => useNavigationModel(), { wrapper: MemoryRouter });
    expect(result.current.agendaOculta).toBe(false);
  });
});

describe("(NV) barra do celular", () => {
  it("com a flag, a aba Agenda some e as outras ficam", () => {
    h.flags = { agenda_so_no_comando: true };
    render(<MemoryRouter><MobileBottomNav /></MemoryRouter>);
    expect(screen.queryByTestId("tab-agenda")).toBeNull();
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
  });

  it("sem a flag, a aba Agenda continua", () => {
    render(<MemoryRouter><MobileBottomNav /></MemoryRouter>);
    expect(screen.getByTestId("tab-agenda")).toBeInTheDocument();
  });
});

describe("(NV) paleta de comandos", () => {
  const paleta = () =>
    render(
      <MemoryRouter>
        <Command>
          <CommandGroupRecents onClose={vi.fn()} />
          <CommandGroupNavigation onClose={vi.fn()} />
        </Command>
      </MemoryRouter>,
    );

  it("com a flag, 'Agenda' sai da navegação e dos recentes", () => {
    h.flags = { agenda_so_no_comando: true };
    h.recentes = ["nav-agenda", "nav-leads"];
    paleta();
    expect(screen.queryByText("Agenda")).toBeNull();
    expect(screen.getAllByText("Leads").length).toBeGreaterThanOrEqual(1);
  });

  it("sem a flag, 'Agenda' aparece na navegação e nos recentes", () => {
    h.recentes = ["nav-agenda"];
    paleta();
    expect(screen.getAllByText("Agenda").length).toBe(2);
  });
});
