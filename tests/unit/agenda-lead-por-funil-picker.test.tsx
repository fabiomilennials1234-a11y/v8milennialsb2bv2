/**
 * `LeadPorFunilPicker` — o par Funil → Lead da Agenda.
 *
 * Cobre os estados que o pedido enumera: nenhum funil escolhido, funil sem
 * leads, carregando, erro, muitos leads, lead escolhido, e — o que mais
 * importa — TROCAR O FUNIL DEPOIS DE ESCOLHER O LEAD.
 *
 * O `Select` do Radix é dublado por um `<select>` nativo, que é como o resto da
 * suíte já lida com ele: o primitivo depende de `hasPointerCapture`, que o
 * jsdom não implementa.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

type SelProps = {
  value?: string;
  onValueChange?: (v: string) => void;
  children?: React.ReactNode;
  disabled?: boolean;
};

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: SelProps) =>
    React.createElement(
      "select",
      {
        "data-testid": "select-funil",
        value: value ?? "",
        disabled,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
          onValueChange?.(e.target.value),
      },
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: SelProps) =>
    React.createElement(React.Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) =>
    React.createElement("option", { value }, children),
}));

// ── Dublês dos dados ────────────────────────────────────────────────────────

const funis = {
  data: [] as Array<{
    id: string;
    name: string;
    slug?: string;
    type?: string;
    is_active?: boolean;
  }>,
  isLoading: false,
  isError: false,
};

const displayConfig = {
  data: [] as Array<{ pipe_type: string; display_name: string }>,
};

vi.mock("@/modules/pipelines", () => ({
  usePipelines: () => funis,
  usePipelineDisplayConfig: () => displayConfig,
}));

const leadsDoFunil = {
  data: undefined as
    | { leads: Array<Record<string, unknown>>; temMais: boolean }
    | undefined,
  isFetching: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
};

const leadPorId = {
  data: null as Record<string, unknown> | null,
  isLoading: false,
};

/** O que o hook recebeu na última renderização — prova o recorte por funil. */
let ultimaChamada: { pipelineId?: string | null; search?: string } | null = null;

vi.mock("@/modules/leads", () => ({
  useLeadsPorFunil: (p: { pipelineId?: string | null; search?: string }) => {
    ultimaChamada = p;
    return leadsDoFunil;
  },
  useLeadById: () => leadPorId,
}));

const { LeadPorFunilPicker, SEM_FUNIL } = await import(
  "@/modules/engagement/components/agenda/LeadPorFunilPicker"
);

// ── Helpers ─────────────────────────────────────────────────────────────────

const COMERCIAL = { id: "p-comercial", name: "Funil Comercial" };
const REATIVACAO = { id: "p-reativacao", name: "Funil Reativacao" };

function montar(
  value: { pipelineId: string | null; leadId: string | null } = {
    pipelineId: null,
    leadId: null,
  },
) {
  const onChange = vi.fn();
  render(
    React.createElement(LeadPorFunilPicker, { value, onChange }),
  );
  return { onChange };
}

beforeEach(() => {
  funis.data = [COMERCIAL, REATIVACAO];
  funis.isLoading = false;
  funis.isError = false;
  displayConfig.data = [];
  leadsDoFunil.data = { leads: [], temMais: false };
  leadsDoFunil.isFetching = false;
  leadsDoFunil.isError = false;
  leadsDoFunil.error = null;
  leadPorId.data = null;
  leadPorId.isLoading = false;
  ultimaChamada = null;
});

// ── Testes ──────────────────────────────────────────────────────────────────

describe("LeadPorFunilPicker", () => {
  it("lista TODOS os funis da org, de sistema e customizados, sem configuracao por funil", () => {
    funis.data = [
      COMERCIAL,
      REATIVACAO,
      { id: "p-posvenda", name: "Funil Pos-venda" },
      { id: "p-parceiros", name: "Funil Parceiros" },
    ];
    montar();

    const opcoes = Array.from(
      screen.getByTestId("select-funil").querySelectorAll("option"),
    ).map((o) => o.textContent);

    expect(opcoes).toEqual([
      "Nenhum funil",
      "Funil Comercial",
      "Funil Reativacao",
      "Funil Pos-venda",
      "Funil Parceiros",
    ]);
  });

  it("🚨 rotula funil de SISTEMA pelo nome que a org usa, nao pelo nome do seed", () => {
    // `pipelines.name` de funil de sistema é fixo no seed ("Qualificação"),
    // mas a navegação e o hub rotulam por `display_name` ("Oportunidades", e
    // renomeável por org). Sem o cruzamento, o seletor da Agenda seria o único
    // lugar do produto a chamar o funil por um nome que a pessoa nunca viu.
    funis.data = [
      { id: "p-wa", name: "Qualificação", slug: "whatsapp", type: "system" },
      { id: "p-cus", name: "Funil do Bolívar", type: "custom" },
    ];
    displayConfig.data = [
      { pipe_type: "whatsapp", display_name: "Oportunidades" },
    ];
    montar();

    const opcoes = Array.from(
      screen.getByTestId("select-funil").querySelectorAll("option"),
    ).map((o) => o.textContent);

    expect(opcoes).toContain("Oportunidades");
    expect(opcoes).not.toContain("Qualificação");
    // Funil custom não entra nessa tabela — o nome dele já é o que o usuário deu.
    expect(opcoes).toContain("Funil do Bolívar");
  });

  it("🚨 funil ARQUIVADO que está gravado na reunião continua visível, marcado", () => {
    // A FK é `ON DELETE SET NULL`: arquivar (`is_active=false`) NÃO zera
    // `meetings.pipeline_id`. Sem a opção sintética o Radix cai no placeholder
    // e a tela diz "Nenhum funil" numa reunião que TEM funil gravado.
    funis.data = [
      COMERCIAL,
      { id: "p-morto", name: "Funil Antigo", is_active: false },
    ];
    montar({ pipelineId: "p-morto", leadId: null });

    const opcoes = Array.from(
      screen.getByTestId("select-funil").querySelectorAll("option"),
    ).map((o) => o.textContent);

    expect(opcoes).toContain("Funil Antigo (arquivado)");
  });

  it("esconde funil inativo — `usePipelines` nao filtra `is_active` sozinho", () => {
    funis.data = [COMERCIAL, { ...REATIVACAO, is_active: false }];
    montar();

    const opcoes = Array.from(
      screen.getByTestId("select-funil").querySelectorAll("option"),
    ).map((o) => o.textContent);

    expect(opcoes).not.toContain("Funil Reativacao");
    expect(opcoes).toContain("Funil Comercial");
  });

  it("sem funil escolhido: pede o funil e NAO oferece busca que nao teria onde procurar", () => {
    montar({ pipelineId: null, leadId: null });

    expect(
      screen.getByText("Escolha um funil acima para buscar os leads dele."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Buscar lead no funil")).toBeNull();
    // E não consulta nada.
    expect(ultimaChamada?.pipelineId).toBeNull();
  });

  it("consulta os leads DO funil escolhido", () => {
    montar({ pipelineId: COMERCIAL.id, leadId: null });
    expect(ultimaChamada?.pipelineId).toBe(COMERCIAL.id);
  });

  it("funil sem leads tem texto proprio, diferente de 'a busca nao achou'", () => {
    leadsDoFunil.data = { leads: [], temMais: false };
    montar({ pipelineId: COMERCIAL.id, leadId: null });

    expect(screen.getByText("Este funil ainda não tem leads.")).toBeTruthy();
  });

  it("busca sem resultado nao se confunde com funil vazio, e o termo chega ao servidor", () => {
    vi.useFakeTimers();
    try {
      leadsDoFunil.data = { leads: [], temMais: false };
      render(
        React.createElement(LeadPorFunilPicker, {
          value: { pipelineId: COMERCIAL.id, leadId: null },
          onChange: vi.fn(),
        }),
      );

      // Antes de digitar: a frase é a do funil vazio.
      expect(screen.getByText("Este funil ainda não tem leads.")).toBeTruthy();

      fireEvent.change(screen.getByLabelText("Buscar lead no funil"), {
        target: { value: "zulmira" },
      });
      // Vence o debounce de 300ms.
      act(() => {
        vi.advanceTimersByTime(400);
      });

      // O termo foi para o HOOK (servidor), não para um filtro em memória.
      expect(ultimaChamada?.search).toBe("zulmira");
      // E a frase muda: "não achei" ≠ "não tem".
      expect(
        screen.getByText("Nenhum lead deste funil corresponde à busca."),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("carregando com a lista vazia mostra spinner, e nao 'funil sem leads'", () => {
    leadsDoFunil.data = undefined;
    leadsDoFunil.isFetching = true;
    montar({ pipelineId: COMERCIAL.id, leadId: null });

    expect(screen.queryByText("Este funil ainda não tem leads.")).toBeNull();
  });

  it("erro ao carregar leads aparece na tela, com como tentar de novo", () => {
    leadsDoFunil.data = undefined;
    leadsDoFunil.isError = true;
    leadsDoFunil.error = new Error("PGRST301");
    montar({ pipelineId: COMERCIAL.id, leadId: null });

    expect(
      screen.getByText(/Não foi possível carregar os leads deste funil/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Tentar de novo"));
    expect(leadsDoFunil.refetch).toHaveBeenCalled();
  });

  it("muitos leads: avisa que a lista foi cortada em vez de mentir que acabou", () => {
    leadsDoFunil.data = {
      leads: [{ id: "l1", name: "Ana", company: null, phone: null, email: null }],
      temMais: true,
    };
    montar({ pipelineId: COMERCIAL.id, leadId: null });

    expect(screen.getByText(/refine a busca/i)).toBeTruthy();
  });

  it("escolher um lead devolve o par funil+lead", () => {
    leadsDoFunil.data = {
      leads: [
        { id: "l1", name: "Ana Souza", company: "Aurora", phone: null, email: null },
      ],
      temMais: false,
    };
    const { onChange } = montar({ pipelineId: COMERCIAL.id, leadId: null });

    fireEvent.click(screen.getByText("Ana Souza"));

    // S6: o par virou TRIO. Este lead não tem entradas no dublê, então o
    // negócio sai `null` — e a reunião é criada do mesmo jeito.
    expect(onChange).toHaveBeenCalledWith({
      pipelineId: COMERCIAL.id,
      leadId: "l1",
      dealId: null,
    });
  });

  it("lead escolhido aparece pelo NOME, resolvido por id — nao pela lista", () => {
    // Numa reunião reaberta o lead pode estar fora das 25 primeiras.
    leadsDoFunil.data = { leads: [], temMais: false };
    leadPorId.data = { id: "l99", name: "Zulmira Palheiro", company: "Fabrica X" };
    montar({ pipelineId: COMERCIAL.id, leadId: "l99" });

    expect(screen.getByText(/Zulmira Palheiro/)).toBeTruthy();
  });

  it("🚨 trocar o funil LIMPA o lead ja escolhido", () => {
    const { onChange } = montar({
      pipelineId: COMERCIAL.id,
      leadId: "l1",
    });

    fireEvent.change(screen.getByTestId("select-funil"), {
      target: { value: REATIVACAO.id },
    });

    // S6: o negócio morre junto com o lead — sobreviver gravaria a reunião no
    // card de um negócio do funil ANTIGO.
    expect(onChange).toHaveBeenCalledWith({
      pipelineId: REATIVACAO.id,
      leadId: null,
      dealId: null,
    });
  });

  it("🚨 limpar o funil tambem limpa o lead", () => {
    const { onChange } = montar({ pipelineId: COMERCIAL.id, leadId: "l1" });

    fireEvent.change(screen.getByTestId("select-funil"), {
      target: { value: SEM_FUNIL },
    });

    expect(onChange).toHaveBeenCalledWith({
      pipelineId: null,
      leadId: null,
      dealId: null,
    });
  });

  it("limpar o lead mantem o funil", () => {
    leadPorId.data = { id: "l1", name: "Ana", company: null };
    const { onChange } = montar({ pipelineId: COMERCIAL.id, leadId: "l1" });

    fireEvent.click(screen.getByText("Limpar"));

    expect(onChange).toHaveBeenCalledWith({
      pipelineId: COMERCIAL.id,
      leadId: null,
      dealId: null,
    });
  });

  it("org sem funil nenhum diz isso, em vez de um seletor vazio e mudo", () => {
    funis.data = [];
    montar();
    expect(
      screen.getByText("Esta organização ainda não tem funis."),
    ).toBeTruthy();
  });

  it("falha ao carregar os funis aparece na tela", () => {
    funis.isError = true;
    montar();
    expect(
      screen.getByText("Não foi possível carregar os funis."),
    ).toBeTruthy();
  });
});
