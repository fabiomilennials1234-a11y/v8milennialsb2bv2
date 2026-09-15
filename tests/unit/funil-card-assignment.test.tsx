import type { ComponentProps, ReactNode } from "react";
import type { LeadCardData } from "@/modules/leads";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FunilKanban } from "@/modules/pipelines/components/funis/FunilKanban";

vi.mock("@/modules/pipelines/components/kanban/DraggableKanbanBoard", () => ({
  DraggableKanbanBoard: ({ columns, renderCard }: { columns: { items: LeadCardData[] }[]; renderCard: (item: LeadCardData) => ReactNode }) => <>{columns.flatMap((c) => c.items.map((item) => <div key={item.id}>{renderCard(item)}</div>))}</>,
}));
vi.mock("@/modules/leads", () => ({ LeadCard: ({ lead }: { lead: LeadCardData }) => <output data-testid="card">{JSON.stringify(lead)}</output> }));
vi.mock("@/modules/identity", () => ({ useCanDo: () => ({ allowed: true }) }));
vi.mock("@/modules/workflows/hooks/useStageWorkflows", () => ({ useCustomPipeWorkflowCounts: () => ({ data: {} }), useCustomPipeStageWorkflows: () => ({ data: [] }) }));
vi.mock("@/modules/engagement/hooks/useAcoesDoDia", () => ({ useCreateAcaoDoDia: () => ({}) }));
vi.mock("@/modules/pipelines/components/kanban/ExportStageDialog", () => ({ ExportStageDialog: () => null }));
vi.mock("@/modules/pipelines/components/kanban/StageWorkflowsBadge", () => ({ StageWorkflowsBadge: () => null }));
vi.mock("@/modules/pipelines/components/kanban/MergedFunnelCardActions", () => ({ MergedFunnelCardActions: () => null }));
vi.mock("@/modules/leads/components/bulk-actions/BulkActionBar", () => ({ BulkActionBar: () => null }));

describe("atribuição no card do funil", () => {
  it("mostra os dois responsáveis canônicos e atualiza quando são removidos", () => {
    const pre = { name: "Mikelli", avatar_url: "/pre.png" };
    const sale = { name: "Nicolodi", avatar_url: "/sale.png" };
    const props = {
      pipelineId: "p", stages: [{ stage_key: "open", name: "Aberto" }], onMove: vi.fn(),
      stageData: { open: { items: [{ id: "entry", lead_id: "lead", stage_key: "open", lead: {
        name: "Cliente", responsible: { name: "Furstenberg" }, closer: { name: "Antigo" },
        pre_sale_responsible: pre as typeof pre | null, sale_responsible: sale as typeof sale | null,
      } }] } },
    };
    const renderProps = () => ({ ...props, stageData: { ...props.stageData } }) as unknown as ComponentProps<typeof FunilKanban>;
    const view = render(<FunilKanban {...renderProps()} />);
    const card = () => JSON.parse(screen.getByTestId("card").textContent!);
    expect(card().preSaleResponsible).toEqual(pre);
    expect(card().saleResponsible).toEqual(sale);
    props.stageData.open.items[0].lead.pre_sale_responsible = null;
    props.stageData.open.items[0].lead.sale_responsible = null;
    view.rerender(<FunilKanban {...renderProps()} />);
    expect(card().preSaleResponsible).toBeNull();
    expect(card().saleResponsible).toBeNull();
    expect(card().responsible).toBeNull();
  });
});
