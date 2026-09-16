import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  navigate: vi.fn(),
  signOut: vi.fn(),
  refetch: vi.fn(),
  setOrg: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/modules/identity/gestor/hooks/useGestorOrganizations", () => ({
  useGestorOrganizations: mocks.overview,
}));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ signOut: mocks.signOut }),
}));
vi.mock("@/modules/identity/org-team/hooks/useCurrentTeamMember", () => ({
  setSelectedOrgId: mocks.setOrg,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("@/components/ui/branding/TorqueLoader", () => ({
  TorqueLoader: () => <div data-testid="loader" />,
}));

import AreaGestor from "@/modules/identity/gestor/pages/AreaGestor";

const organizations = [
  {
    organization_id: "o1",
    name: "Org Alpha",
    slug: "alpha",
    leads_last_7_days: 123,
    sales_last_7_days: 17,
    online_users: [{ user_id: "u1", name: "Ana" }],
    measured_at: "2026-09-16T12:00:00Z",
  },
  {
    organization_id: "o2",
    name: "Org Beta",
    slug: "beta",
    leads_last_7_days: 0,
    sales_last_7_days: 0,
    online_users: [],
    measured_at: "2026-09-16T12:00:00Z",
  },
];
function setup(overrides: Record<string, unknown> = {}) {
  mocks.overview.mockReturnValue({
    data: organizations,
    isLoading: false,
    isError: false,
    isFetching: false,
    dataUpdatedAt: Date.parse("2026-09-16T12:00:00Z"),
    refetch: mocks.refetch,
    ...overrides,
  });
}
describe("Área do gestor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetch.mockResolvedValue({ data: organizations, error: null });
    mocks.invalidate.mockResolvedValue(undefined);
    setup();
  });
  it("mostra carregamento", () => {
    setup({ isLoading: true });
    render(<AreaGestor />);
    expect(screen.getByTestId("loader")).toBeInTheDocument();
  });
  it("mostra organizações em linhas com indicadores e usuários", () => {
    render(<AreaGestor />);
    const table = screen.getByRole("table");
    const alpha = within(table).getByRole("row", { name: /Org Alpha/ });
    expect(within(alpha).getByText("123")).toBeInTheDocument();
    expect(within(alpha).getByText("17")).toBeInTheDocument();
    fireEvent.click(within(alpha).getByText(/1 online/));
    expect(within(alpha).getByText("Ana")).toBeVisible();
    const beta = within(table).getByRole("row", { name: /Org Beta/ });
    expect(within(beta).getAllByText("0")).toHaveLength(2);
    expect(within(beta).getByText(/0 online/)).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Nova Organização|Faturamento|Modo Master|Acesso Total|Suporte/,
      ),
    ).not.toBeInTheDocument();
  });
  it("filtra por nome e slug, distinguindo busca vazia de ausência de vínculo", () => {
    render(<AreaGestor />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: " BETA " },
    });
    expect(screen.getByText("Org Beta")).toBeInTheDocument();
    expect(screen.queryByText("Org Alpha")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "inexistente" },
    });
    expect(
      screen.getByText("Nenhuma organização encontrada para essa busca."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nenhuma organização vinculada"),
    ).not.toBeInTheDocument();
  });
  it("não apresenta erro de consulta como lista vazia nem mostra dados antigos", () => {
    setup({ isError: true });
    render(<AreaGestor />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Org Alpha")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Nenhuma organização vinculada"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it("trata gestor sem vínculos", () => {
    setup({ data: [] });
    render(<AreaGestor />);
    expect(
      screen.getByText("Nenhuma organização vinculada"),
    ).toBeInTheDocument();
  });
  it("revalida vínculo, seleciona organização e só então entra", async () => {
    render(<AreaGestor />);
    fireEvent.click(
      screen.getByRole("button", { name: "Entrar em Org Alpha" }),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith("/dashboard"),
    );
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(mocks.setOrg).toHaveBeenCalledWith("o1");
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });
  it.each([
    { data: organizations.slice(1), error: null },
    { data: organizations, error: new Error("Sem acesso") },
  ])(
    "não entra quando o vínculo foi revogado ou a revalidação falha",
    async (result) => {
      mocks.refetch.mockResolvedValue(result);
      render(<AreaGestor />);
      fireEvent.click(
        screen.getByRole("button", { name: "Entrar em Org Alpha" }),
      );
      await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
      expect(mocks.setOrg).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );
  it("bloqueia cliques concorrentes durante a entrada", async () => {
    let finish!: (result: unknown) => void;
    mocks.refetch.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<AreaGestor />);
    fireEvent.click(
      screen.getByRole("button", { name: "Entrar em Org Alpha" }),
    );
    expect(
      screen.getByRole("button", { name: "Entrar em Org Beta" }),
    ).toBeDisabled();
    finish({ data: organizations, error: null });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
  });
  it("permite atualizar e sair, sem oferecer suporte", () => {
    render(<AreaGestor />);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Suporte" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
