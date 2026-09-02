/**
 * SCRUM-634 — FunnelViewsMenu parametrizado por pipelineId.
 *
 * O menu de views do funil precisa funcionar pra QUALQUER funil (sistema ou
 * custom): recebendo `pipelineId`, ele constrói o entity_type canônico
 * `pipeline:{uuid}` e busca as views salvas por ele. O escape legado
 * (`entityType="pipe_whatsapp"`) segue vivo até as 3 páginas pré-unificação
 * morrerem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { List } from "lucide-react";
import { FunnelViewsMenu } from "@/modules/pipelines/components/shared/FunnelViewsMenu";
import type { SavedView } from "@/types/saved-views";

const useSavedViewsMock = vi.fn();

vi.mock("@/modules/platform/hooks/useSavedViews", () => ({
  useSavedViews: (entityType: string) => useSavedViewsMock(entityType),
  useCreateSavedView: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSavedView: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSavedView: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({
    organizationId: "org-1",
    teamMemberId: "tm-1",
  }),
}));

const CUSTOM_PIPELINE_ID = "3f8b2a10-9c4d-4e5f-a6b7-c8d9e0f1a2b3";

function makeView(overrides: Partial<SavedView>): SavedView {
  return {
    id: "view-1",
    organization_id: "org-1",
    owner_id: "user-1",
    name: "Minha view",
    entity_type: `pipeline:${CUSTOM_PIPELINE_ID}`,
    filters: { filterOrigin: "meta_ads" },
    is_shared: false,
    is_system: false,
    position: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const baseProps = {
  viewMode: "kanban" as const,
  onViewModeChange: vi.fn(),
  viewOptions: [{ value: "kanban" as const, icon: List, label: "Kanban" }],
  currentFilters: {},
  defaultFilters: {},
  onApplyFilters: vi.fn(),
  activeViewId: null,
  onActiveViewChange: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useSavedViewsMock.mockReturnValue({ data: [] });
});

describe("FunnelViewsMenu por pipelineId", () => {
  it("consulta views pelo entity_type canônico pipeline:{uuid}", () => {
    render(<FunnelViewsMenu {...baseProps} pipelineId={CUSTOM_PIPELINE_ID} />);
    expect(useSavedViewsMock).toHaveBeenCalledWith(
      `pipeline:${CUSTOM_PIPELINE_ID}`
    );
  });

  it("lista e aplica view salva de funil custom", () => {
    const onApplyFilters = vi.fn();
    const onActiveViewChange = vi.fn();
    const view = makeView({ name: "Quentes do custom" });
    useSavedViewsMock.mockReturnValue({ data: [view] });

    render(
      <FunnelViewsMenu
        {...baseProps}
        pipelineId={CUSTOM_PIPELINE_ID}
        onApplyFilters={onApplyFilters}
        onActiveViewChange={onActiveViewChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /views/i }));
    fireEvent.click(screen.getByText("Quentes do custom"));

    expect(onApplyFilters).toHaveBeenCalledWith({ filterOrigin: "meta_ads" });
    expect(onActiveViewChange).toHaveBeenCalledWith("view-1");
  });

  it("escape legado: entityType slug segue repassado como veio", () => {
    render(<FunnelViewsMenu {...baseProps} entityType="pipe_whatsapp" />);
    expect(useSavedViewsMock).toHaveBeenCalledWith("pipe_whatsapp");
  });

  it("pipelineId que não é uuid estoura na renderização — bug não vira linha no banco", () => {
    // O throw é do helper; aqui garantimos que o componente não o engole.
    expect(() =>
      render(<FunnelViewsMenu {...baseProps} pipelineId="pipe_whatsapp" />)
    ).toThrow(/UUID/);
  });
});
