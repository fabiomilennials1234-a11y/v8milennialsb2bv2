/**
 * ConditionPanel — node "Condição" das automações.
 *
 * Cobre o wiring do campo UTM: renderiza o combobox creatable (não o Input
 * livre), seleção e creatable chamam onUpdate({value}), e trocar de um campo
 * numérico para UTM cai em `contains` sem sobrescrever operador de texto sensato.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [] as Array<{ id: string; name: string }>,
}));

// Hook read-only stubado — o comportamento dele tem teste próprio.
vi.mock("@/modules/workflows/hooks/useOrgUtmValues", () => ({
  UTM_VALUE_FIELDS: new Set([
    "utm_campaign",
    "utm_source",
    "utm_medium",
    "utm_content",
    "utm_term",
  ]),
  useOrgUtmValues: () => ({ values: ["meta_camp"], isLoading: false }),
}));

// Combobox stubado com dois gatilhos: escolher item da lista vs criar valor cru.
vi.mock("../sidebar-panels/UtmValueCombobox", () => ({
  UtmValueCombobox: ({ onChange }: { onChange: (v: string) => void }) => (
    <div data-testid="utm-combobox">
      <button type="button" onClick={() => onChange("meta_camp")}>
        pick-item
      </button>
      <button type="button" onClick={() => onChange("[TESTE CRIATIVOS] BATERIA.")}>
        create-raw
      </button>
    </div>
  ),
}));

// Select do shadcn (Radix) → nativo, pra podermos disparar onValueChange no jsdom.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { ConditionPanel } from "@/modules/workflows/components/sidebar-panels/ConditionPanel";
import type { ConditionNodeData } from "@/types/workflow";

function baseData(overrides: Partial<ConditionNodeData> = {}): ConditionNodeData {
  return {
    type: "condition",
    label: "Cond",
    field: "utm_campaign",
    operator: "contains",
    value: "",
    ...overrides,
  } as ConditionNodeData;
}

/** Localiza o <select> nativo cujo value bate (Campo vs Operador). */
function selectWithValue(v: string): HTMLSelectElement {
  const el = screen
    .getAllByRole("combobox")
    .find((s) => (s as HTMLSelectElement).value === v);
  if (!el) throw new Error(`no select with value ${v}`);
  return el as HTMLSelectElement;
}

beforeEach(() => vi.clearAllMocks());

describe("ConditionPanel — campo UTM", () => {
  it("renderiza o combobox creatable (não o Input livre) para campo UTM", () => {
    render(<ConditionPanel data={baseData({ field: "utm_campaign" })} onUpdate={vi.fn()} />);
    expect(screen.getByTestId("utm-combobox")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Ex: 50")).not.toBeInTheDocument();
  });

  it("renderiza o Input livre para campo não-UTM (origem)", () => {
    render(<ConditionPanel data={baseData({ field: "origin" })} onUpdate={vi.fn()} />);
    expect(screen.getByPlaceholderText("Ex: 50")).toBeInTheDocument();
    expect(screen.queryByTestId("utm-combobox")).not.toBeInTheDocument();
  });

  it("selecionar item da lista chama onUpdate com o valor exato", () => {
    const onUpdate = vi.fn();
    render(<ConditionPanel data={baseData({ field: "utm_source" })} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText("pick-item"));
    expect(onUpdate).toHaveBeenCalledWith({ value: "meta_camp" });
  });

  it("creatable chama onUpdate com o texto cru digitado", () => {
    const onUpdate = vi.fn();
    render(<ConditionPanel data={baseData({ field: "utm_source" })} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText("create-raw"));
    expect(onUpdate).toHaveBeenCalledWith({ value: "[TESTE CRIATIVOS] BATERIA." });
  });

  it("trocar de um campo numérico (score/greater_than) para UTM cai em contains", () => {
    const onUpdate = vi.fn();
    render(
      <ConditionPanel
        data={baseData({ field: "score", operator: "greater_than" })}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(selectWithValue("score"), { target: { value: "utm_campaign" } });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ field: "utm_campaign", operator: "contains" }),
    );
  });

  it("trocar para UTM preserva um operador de texto sensato (starts_with)", () => {
    const onUpdate = vi.fn();
    render(
      <ConditionPanel
        data={baseData({ field: "origin", operator: "starts_with" })}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(selectWithValue("origin"), { target: { value: "utm_source" } });
    // origin → utm são ambos texto: value não é limpo e o operador é mantido.
    expect(onUpdate).toHaveBeenCalledWith({ field: "utm_source" });
  });
});
