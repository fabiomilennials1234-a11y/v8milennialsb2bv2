/**
 * `CreateMeetingDialog` — o par Funil → Lead no caminho de CRIAÇÃO.
 *
 * O que trava aqui:
 *   - o funil escolhido chega ao INSERT junto com o lead (requisitos 5 e 6);
 *   - funil sem lead NÃO é gravado sozinho (vínculo que não aponta para ninguém);
 *   - abrir o diálogo começa sem funil e sem lead (requisito "criar sem funil");
 *   - data apagada não deixa o botão habilitado (defeito HERDADO, corrigido
 *     junto porque a expressão é copiada entre este diálogo e o de edição).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mutate = vi.fn();

vi.mock("@/modules/engagement/hooks/useMeetings", () => ({
  useCreateMeeting: () => ({ mutate, isPending: false }),
}));

vi.mock("@/modules/identity", () => ({
  useTeamMembers: () => ({ data: [] }),
}));

let valorNoPicker: { pipelineId: string | null; leadId: string | null } | null =
  null;
let trocarValor:
  | ((v: { pipelineId: string | null; leadId: string | null }) => void)
  | null = null;

vi.mock(
  "@/modules/engagement/components/agenda/LeadPorFunilPicker",
  () => ({
    LeadPorFunilPicker: ({
      value,
      onChange,
    }: {
      value: { pipelineId: string | null; leadId: string | null };
      onChange: (v: { pipelineId: string | null; leadId: string | null }) => void;
    }) => {
      valorNoPicker = value;
      trocarValor = onChange;
      return React.createElement("div", { "data-testid": "picker" });
    },
  }),
);

const { CreateMeetingDialog } = await import(
  "@/modules/engagement/components/agenda/CreateMeetingDialog"
);

function montar() {
  render(
    React.createElement(CreateMeetingDialog, {
      open: true,
      onOpenChange: vi.fn(),
      initialStart: new Date(2026, 8, 1, 10, 0),
    }),
  );
  fireEvent.change(screen.getByLabelText(/Titulo/), {
    target: { value: "Visita" },
  });
}

beforeEach(() => {
  mutate.mockClear();
  valorNoPicker = null;
  trocarValor = null;
});

describe("CreateMeetingDialog — funil e lead", () => {
  it("abre sem funil e sem lead — dá para criar reunião sem funil", () => {
    montar();
    // S6: o par virou trio — o negócio nasce vazio junto com funil e lead.
    expect(valorNoPicker).toEqual({
      pipelineId: null,
      leadId: null,
      dealId: null,
    });

    fireEvent.click(screen.getByText("Criar atividade"));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      lead_id: null,
      pipeline_id: null,
    });
  });

  it("o funil escolhido chega ao INSERT junto com o lead", () => {
    montar();
    act(() => trocarValor!({ pipelineId: "p-comercial", leadId: "l-42" }));

    fireEvent.click(screen.getByText("Criar atividade"));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      lead_id: "l-42",
      pipeline_id: "p-comercial",
    });
  });

  it("funil sem lead nao e gravado sozinho", () => {
    montar();
    act(() => trocarValor!({ pipelineId: "p-comercial", leadId: null }));

    fireEvent.click(screen.getByText("Criar atividade"));

    expect(mutate.mock.calls[0][0]).toMatchObject({
      lead_id: null,
      pipeline_id: null,
    });
  });

  it("🚨 HERDADO — data apagada DESABILITA o botao (nao so 'nao chama mutate')", () => {
    montar();
    fireEvent.change(screen.getByLabelText(/Inicio/), { target: { value: "" } });

    expect(screen.getByText("Informe inicio e fim")).toBeTruthy();
    // A asserção é o botão desabilitado: sem a guarda, `mutate` também não
    // seria chamado — mas por um RangeError dentro do handler, que é o defeito.
    expect(screen.getByText("Criar atividade").closest("button")).toBeDisabled();
  });
});
