/**
 * ConditionPanel — node "Condição" das automações.
 *
 * Cobre o wiring dos dois campos cujo valor NÃO se digita de cabeça:
 * - UTM: combobox creatable (não Input livre), seleção/creatable chamam
 *   onUpdate({value}), e entrar por um operador numérico cai em `contains`.
 * - Campo personalizado: nome vem do catálogo da org (Select, não texto livre),
 *   valor vem dos valores já respondidos, e campo sumido é sinalizado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [] as Array<{ id: string; name: string }>,
}));

// Catálogo de campos personalizados da org (espelha a Cervejaria Insana).
const customFields = [
  { id: "f1", field_name: "Você tem interesse em:" },
  { id: "f2", field_name: "Cidade:" },
];
vi.mock("@/modules/leads", () => ({
  useLeadOrigins: () => ({ origins: [] as Array<{ slug: string; label: string }> }),
  useLeadCustomFields: () => ({ data: customFields }),
}));

// Hooks read-only stubados — o comportamento deles tem teste próprio.
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

vi.mock("@/modules/workflows/hooks/useOrgCustomFieldValues", () => ({
  useOrgCustomFieldValues: (fieldId?: string | null) => ({
    values: fieldId === "f1" ? ["ainda_não_sei", "barril_de_chopp", "growler"] : [],
    isLoading: false,
  }),
}));

// Combobox stubado com dois gatilhos: escolher item da lista vs criar valor cru.
// Expõe os `values` recebidos para checar de qual fonte vieram.
vi.mock("../sidebar-panels/ValueCombobox", () => ({
  ValueCombobox: ({
    onChange,
    values,
  }: {
    onChange: (v: string) => void;
    values: string[];
  }) => (
    <div data-testid="utm-combobox" data-values={values.join("|")}>
      <button type="button" onClick={() => onChange("meta_camp")}>
        pick-item
      </button>
      <button type="button" onClick={() => onChange("[TESTE CRIATIVOS] BATERIA.")}>
        create-raw
      </button>
      <button type="button" onClick={() => onChange("barril_de_chopp")}>
        pick-barril
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

/**
 * Localiza o <select> que contém uma dada option. Necessário para o seletor de
 * campo personalizado: ele nasce sem valor, e o <select> nativo do jsdom não
 * guarda "" quando nenhuma option casa — ele cai na primeira option.
 */
function selectWithOption(optionValue: string): HTMLSelectElement {
  const el = screen
    .getAllByRole("combobox")
    .find((s) =>
      Array.from((s as HTMLSelectElement).options).some((o) => o.value === optionValue),
    );
  if (!el) throw new Error(`no select containing option ${optionValue}`);
  return el as HTMLSelectElement;
}

beforeEach(() => vi.clearAllMocks());

describe("ConditionPanel — campo UTM", () => {
  it("renderiza o combobox creatable (não o Input livre) para campo UTM", () => {
    render(<ConditionPanel data={baseData({ field: "utm_campaign" })} onUpdate={vi.fn()} />);
    expect(screen.getByTestId("utm-combobox")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Ex: 50")).not.toBeInTheDocument();
  });

  it("renderiza o Input livre para campo de texto simples (faturamento)", () => {
    render(<ConditionPanel data={baseData({ field: "faturamento" })} onUpdate={vi.fn()} />);
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
    // O operador de texto é mantido (nenhuma chave `operator` no patch). O value
    // é limpo porque slug de origem e texto de UTM são domínios incompatíveis.
    expect(onUpdate).toHaveBeenCalledWith({ field: "utm_source", value: "" });
  });
});

describe("ConditionPanel — campo personalizado", () => {
  it("oferece o catálogo da org (Select), não um campo de texto livre", () => {
    render(<ConditionPanel data={baseData({ field: "custom" })} onUpdate={vi.fn()} />);
    // O nome antes era digitado à mão — o placeholder do Input sumiu.
    expect(screen.queryByPlaceholderText("Ex: cargo")).not.toBeInTheDocument();
    expect(screen.getByText("Você tem interesse em:")).toBeInTheDocument();
    expect(screen.getByText("Cidade:")).toBeInTheDocument();
  });

  it("escolher o campo grava `custom.<field_name>` exato e limpa o valor", () => {
    const onUpdate = vi.fn();
    render(<ConditionPanel data={baseData({ field: "custom" })} onUpdate={onUpdate} />);
    fireEvent.change(selectWithOption("Cidade:"), {
      target: { value: "Você tem interesse em:" },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      field: "custom.Você tem interesse em:",
      value: "",
    });
  });

  it("sugere os valores já respondidos do campo escolhido", () => {
    render(
      <ConditionPanel
        data={baseData({ field: "custom.Você tem interesse em:" })}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByTestId("utm-combobox")).toHaveAttribute(
      "data-values",
      "ainda_não_sei|barril_de_chopp|growler",
    );
  });

  it("escolher um valor da lista grava o slug exato do formulário", () => {
    const onUpdate = vi.fn();
    render(
      <ConditionPanel
        data={baseData({ field: "custom.Você tem interesse em:" })}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByText("pick-barril"));
    expect(onUpdate).toHaveBeenCalledWith({ value: "barril_de_chopp" });
  });

  it("campo removido da org continua selecionável e avisa que quebrou", () => {
    render(
      <ConditionPanel data={baseData({ field: "custom.Campo Extinto" })} onUpdate={vi.fn()} />,
    );
    expect(screen.getByText("Campo Extinto (não existe mais)")).toBeInTheDocument();
    expect(screen.getByText(/nunca sera verdadeira/i)).toBeInTheDocument();
  });

  it("entrar em campo personalizado por um operador numérico cai em contains", () => {
    const onUpdate = vi.fn();
    render(
      <ConditionPanel
        data={baseData({ field: "score", operator: "greater_than" })}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(selectWithValue("score"), { target: { value: "custom" } });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ field: "custom", operator: "contains" }),
    );
  });
});
