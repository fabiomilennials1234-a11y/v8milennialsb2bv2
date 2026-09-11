import { afterAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ConditionPanel } from "../sidebar-panels/ConditionPanel";
import type { ConditionNodeData } from "@/types/workflow";

vi.mock("@/modules/identity", () => ({ useResponsibleMembers: () => [] }));
vi.mock("@/modules/leads", () => ({
  useLeadOrigins: () => ({ origins: [] }), useLeadCustomFields: () => ({ data: [] }),
  useTags: () => ({ data: [{ id: "t1", name: "Cliente VIP" }], isLoading: false, isError: false }),
}));
vi.mock("@/modules/pipelines", () => ({ useFunisDaOrg: () => ({ data: [] }), useAllPipelineStages: () => ({ data: [] }) }));
vi.mock("../../hooks/useOrgUtmValues", () => ({ UTM_VALUE_FIELDS: new Set(), useOrgUtmValues: () => ({ values: [] }) }));
vi.mock("../../hooks/useOrgCustomFieldValues", () => ({ useOrgCustomFieldValues: () => ({ values: [] }) }));
vi.mock("../../hooks/useOrgConditionValues", () => ({ useOrgConditionValues: () => ({ values: [] }) }));

// JSDOM omits scrolling; keep real Radix focus/selection behavior.
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
afterAll(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

function Harness() {
  const [data, setData] = useState<ConditionNodeData>({ type: "condition", label: "Regra", conditionMode: "field", field: "has_open_deal", operator: "equals", value: "" });
  return <><ConditionPanel data={data} onUpdate={(update) => setData((old) => ({ ...old, ...update }))} /><output aria-label="Valor salvo">{data.value}</output></>;
}

describe("real condition dropdown interaction", () => {
  it("selects Sim using the real Radix dropdown and keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Valor da condição" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("option", { name: "Sim" })).toBeVisible();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByLabelText("Valor salvo")).toHaveTextContent("true"));
    expect(trigger).toHaveFocus();
  });
});
