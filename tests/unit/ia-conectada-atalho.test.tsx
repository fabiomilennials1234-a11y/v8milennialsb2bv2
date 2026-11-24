/**
 * Atalho "IA conectada" (Pitstop › Administração → `/ia-conectada`): leva à seção de tokens
 * de Configurações com o diálogo "Novo token" já aberto. Sem a flag `crm_mcp`, volta ao Pitstop.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { IaConectadaRoute } from "@/modules/platform/components/IaConectadaRoute";
import { PersonalAccessTokensPanel } from "@/modules/platform/components/settings/PersonalAccessTokensPanel";

let flag = { enabled: true, isLoading: false };
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => flag,
}));
vi.mock("@/modules/platform/hooks/usePersonalAccessTokens", () => ({
  usePersonalAccessTokens: () => ({ data: [], isLoading: false }),
  useCreatePersonalAccessToken: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokePersonalAccessToken: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: { id: "u-1" } }),
  useIdentity: () => ({ isAdmin: false }),
}));

function Onde() {
  const l = useLocation();
  return <output data-testid="onde">{`${l.pathname}${l.search}`}</output>;
}

function abrir(url: string, elemento: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/ia-conectada" element={elemento} />
        <Route path="*" element={<Onde />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("rota /ia-conectada", () => {
  it("com a flag, cai na seção de tokens pedindo o diálogo de criação", () => {
    flag = { enabled: true, isLoading: false };
    abrir("/ia-conectada", <IaConectadaRoute />);
    expect(screen.getByTestId("onde").textContent).toBe("/configuracoes/api-webhooks?secao=mcp&novo=1");
  });

  it("sem a flag, volta ao Pitstop (a seção nem existe para a org)", () => {
    flag = { enabled: false, isLoading: false };
    abrir("/ia-conectada", <IaConectadaRoute />);
    expect(screen.getByTestId("onde").textContent).toBe("/pitstop");
  });

  it("enquanto a flag carrega, não decide nada", () => {
    flag = { enabled: false, isLoading: true };
    abrir("/ia-conectada", <IaConectadaRoute />);
    expect(screen.queryByTestId("onde")).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

function painelEm(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <PersonalAccessTokensPanel />
              <Onde />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("painel de tokens chegando pelo atalho", () => {
  it("`novo=1` abre o diálogo de criação e sai da URL (recarregar não reabre)", async () => {
    flag = { enabled: false, isLoading: false };
    painelEm("/configuracoes/api-webhooks?secao=mcp&novo=1");
    expect(await screen.findByText("Novo token de IA")).toBeInTheDocument();
    expect(screen.getByTestId("onde").textContent).toBe("/configuracoes/api-webhooks?secao=mcp");
  });

  it("sem `novo=1`, o diálogo fica fechado", () => {
    flag = { enabled: false, isLoading: false };
    painelEm("/configuracoes/api-webhooks?secao=mcp");
    expect(screen.queryByText("Novo token de IA")).toBeNull();
  });
});
