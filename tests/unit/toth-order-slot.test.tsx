import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TothOrderDraftSlot } from "@/modules/leads/components/deal-card/TothOrderDraftSlot";

const pilot = "4922638c-4909-494e-ba10-12282ec0b161";
const flag = vi.hoisted(() => vi.fn());
vi.mock("@/modules/platform/feature-flags", () => ({ useFeatureFlag: flag }));
vi.mock("@/modules/integrations/toth-order-drafts", () => ({
  TOTH_ORDER_DRAFTS_FLAG: "toth_order_drafts",
  TOTH_ORDER_PILOT_ORG_ID: "4922638c-4909-494e-ba10-12282ec0b161",
  isTothOrderDraftPilot: (org: string, value: unknown) =>
    org === "4922638c-4909-494e-ba10-12282ec0b161" && value === true,
  TothOrderDraftPanel: ({ dealId }: { dealId: string }) => <div>Rascunho {dealId}</div>,
}));

beforeEach(() => { flag.mockReset(); flag.mockReturnValue({ enabled: true, isLoading: false }); });

describe("piloto de rascunhos do Toth", () => {
  it("não consulta a flag nem monta o painel em outra organização", () => {
    render(<TothOrderDraftSlot dealId="negocio" organizationId="outra" />);
    expect(flag).not.toHaveBeenCalled();
    expect(screen.queryByText("Rascunho negocio")).not.toBeInTheDocument();
  });
  it.each([
    { enabled: false, isLoading: false },
    { enabled: true, isLoading: true },
  ])("mantém a superfície ausente com flag desligada ou carregando (%j)", value => {
    flag.mockReturnValue(value);
    render(<TothOrderDraftSlot dealId="negocio" organizationId={pilot} />);
    expect(screen.queryByText("Rascunho negocio")).not.toBeInTheDocument();
  });
  it("monta apenas para o negócio atual no piloto habilitado e remove ao desligar", () => {
    const { rerender } = render(<TothOrderDraftSlot dealId="primeiro" organizationId={pilot} />);
    expect(screen.getByText("Rascunho primeiro")).toBeInTheDocument();
    rerender(<TothOrderDraftSlot dealId="segundo" organizationId={pilot} />);
    expect(screen.queryByText("Rascunho primeiro")).not.toBeInTheDocument();
    expect(screen.getByText("Rascunho segundo")).toBeInTheDocument();
    flag.mockReturnValue({ enabled: false, isLoading: false });
    rerender(<TothOrderDraftSlot dealId="segundo" organizationId={pilot} />);
    expect(screen.queryByText("Rascunho segundo")).not.toBeInTheDocument();
  });
});
