import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

const tagsMock = vi.fn();
const automacoesMock = vi.fn();

vi.mock("../../hooks/useTags", () => ({ useTags: () => tagsMock() }));
vi.mock("../../hooks/useTagAddedAutomations", () => ({ useTagAddedAutomations: () => automacoesMock() }));

import { ImportTagsField, ImportTagsOutcome } from "./ImportTagsField";
import { MAX_ETIQUETAS_POR_IMPORT } from "../../lib/import-tags";

const VIP = { id: "t-vip", name: "VIP", color: "#f59e0b" };
const FEIRA = { id: "t-feira", name: "Feira São Paulo", color: null };

function Campo({ inicial = [] as string[], totalLeads = 200 }) {
  const [ids, setIds] = useState<string[]>(inicial);
  return <ImportTagsField value={ids} onChange={setIds} totalLeads={totalLeads} />;
}

beforeEach(() => {
  tagsMock.mockReturnValue({ data: [VIP, FEIRA], isLoading: false });
  automacoesMock.mockReturnValue({ data: [], isError: false });
});

describe("ImportTagsField", () => {
  it("marca e desmarca pela lista", () => {
    render(<Campo />);
    const vip = screen.getByRole("button", { name: "VIP" });

    fireEvent.click(vip);
    expect(vip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tirar a etiqueta VIP" })).toBeInTheDocument();

    fireEvent.click(vip);
    expect(vip).toHaveAttribute("aria-pressed", "false");
  });

  it("busca ignora acento e caixa", () => {
    render(<Campo />);

    fireEvent.change(screen.getByPlaceholderText("Buscar etiqueta…"), { target: { value: "sao" } });

    expect(screen.getByRole("button", { name: "Feira São Paulo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "VIP" })).not.toBeInTheDocument();
  });

  it("avisa as automações que vão rodar e quantas execuções", () => {
    automacoesMock.mockReturnValue({
      data: [{ id: "w1", name: "Boas-vindas VIP", trigger_config: { tag_name: "vip" } }],
      isError: false,
    });
    render(<Campo inicial={["t-vip"]} totalLeads={1500} />);

    expect(screen.getByText(/1 automação de etiqueta vai rodar/)).toBeInTheDocument();
    expect(screen.getByText(/Boas-vindas VIP/)).toBeInTheDocument();
    expect(screen.getByText(/1\.500 execuções/)).toBeInTheDocument();
  });

  it("sem automação casando, não avisa", () => {
    automacoesMock.mockReturnValue({
      data: [{ id: "w1", name: "Só Frio", trigger_config: { tag_name: "frio" } }],
      isError: false,
    });
    render(<Campo inicial={["t-vip"]} />);

    expect(screen.queryByText(/automaç/)).not.toBeInTheDocument();
  });

  it(`trava a escolha em ${MAX_ETIQUETAS_POR_IMPORT}`, () => {
    const muitas = Array.from({ length: MAX_ETIQUETAS_POR_IMPORT + 1 }, (_, i) => ({
      id: `t-${i}`,
      name: `Etiqueta ${i}`,
      color: null,
    }));
    tagsMock.mockReturnValue({ data: muitas, isLoading: false });
    render(<Campo inicial={muitas.slice(0, MAX_ETIQUETAS_POR_IMPORT).map((t) => t.id)} />);

    expect(screen.getByRole("button", { name: `Etiqueta ${MAX_ETIQUETAS_POR_IMPORT}` })).toBeDisabled();
    expect(screen.getByText(/Limite de 20 etiquetas/)).toBeInTheDocument();
  });

  it("org sem etiqueta diz onde criar", () => {
    tagsMock.mockReturnValue({ data: [], isLoading: false });
    render(<Campo />);

    expect(screen.getByText(/Configurações › Tags/)).toBeInTheDocument();
  });
});

describe("ImportTagsOutcome", () => {
  const base = { total: 3, created: 3, updated: 0, rejected: 0, errors: [] };

  it("some quando o import não levou etiquetas", () => {
    const { container } = render(<ImportTagsOutcome report={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("confirma quantos leads receberam", () => {
    render(<ImportTagsOutcome report={{ ...base, tags: { leads: 3, failed: 0 } }} />);
    expect(screen.getByText("Etiquetas aplicadas em 3 leads.")).toBeInTheDocument();
  });

  it("diz quantos ficaram sem quando um lote falha", () => {
    render(<ImportTagsOutcome report={{ ...base, tags: { leads: 1, failed: 2 } }} />);
    expect(screen.getByText(/2 leads ficaram sem as etiquetas/)).toBeInTheDocument();
  });
});
