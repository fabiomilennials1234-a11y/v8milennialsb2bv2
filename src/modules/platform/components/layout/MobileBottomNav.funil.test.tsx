import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitBranch } from "lucide-react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import type { NavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import { MobileBottomNav } from "./MobileBottomNav";

/**
 * A aba Funis do mobile volta ao último funil aberto. Sem histórico válido
 * segue no hub `/funis`, como sempre foi (não vira "funil padrão" de repente).
 */

vi.mock("@/shared/hooks/use-viewport", () => ({ useViewport: () => ({ isMobile: true }) }));
vi.mock("@/contexts/MobileChatContext", () => ({ useMobileChatContext: () => ({ isChatThreadOpen: false }) }));
vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
  useOrganization: () => ({ organizationId: "org-1" }),
  useOrganizationSettings: () => ({ settings: { default_pipeline_id: "f-padrao" } }),
}));
vi.mock("@/modules/platform/hooks/useNavigationModel", () => ({
  useNavigationModel: (): NavigationModel =>
    ({
      primary: [
        {
          label: "Funis",
          icon: GitBranch,
          path: "/funis",
          children: [
            { label: "Vendas", icon: GitBranch, path: "/funil/vendas" },
            { label: "Pós-venda", icon: GitBranch, path: "/funil/pos-venda" },
          ],
        },
      ],
    }) as unknown as NavigationModel,
}));

function Onde() {
  return <div data-testid="onde">{useLocation().pathname}</div>;
}

function renderNav() {
  return render(
    <MemoryRouter initialEntries={["/chat-whatsapp"]}>
      <MobileBottomNav />
      <Routes>
        <Route path="*" element={<Onde />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());

describe("MobileBottomNav — aba Funis", () => {
  it("volta ao último funil aberto", async () => {
    window.localStorage.setItem("v8:ui:last-funil:org-1:user-1", "pos-venda");
    renderNav();
    await userEvent.setup().click(screen.getByTestId("tab-funis"));
    expect(screen.getByTestId("onde")).toHaveTextContent("/funil/pos-venda");
  });

  it("sem histórico válido, segue no hub", async () => {
    renderNav();
    await userEvent.setup().click(screen.getByTestId("tab-funis"));
    expect(screen.getByTestId("onde")).toHaveTextContent("/funis");
  });

  it("histórico de funil que não existe mais, segue no hub", async () => {
    window.localStorage.setItem("v8:ui:last-funil:org-1:user-1", "apagado");
    renderNav();
    await userEvent.setup().click(screen.getByTestId("tab-funis"));
    expect(screen.getByTestId("onde")).toHaveTextContent("/funis");
  });
});
