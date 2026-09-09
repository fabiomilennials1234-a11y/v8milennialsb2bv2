/**
 * `EditMeetingDialog` — reabrir a reunião e mexer no funil e no lead.
 *
 * Até esta branch a Agenda NÃO TINHA edição: o popover de detalhe só registrava
 * comparecimento e excluía. Estes testes travam os dois pontos que o pedido
 * enumera (requisito 7) e o modo de falha que o desenho do `useUpdateMeeting`
 * cria:
 *
 *   - reabrir mostra o funil e o lead que foram GRAVADOS;
 *   - salvar manda `pipeline_id` junto com `lead_id`;
 *   - enquanto a reunião não carregou, NÃO dá para salvar — `useUpdateMeeting`
 *     faz `.update(updates)` cru, sem merge, então gravar um formulário
 *     meio-semeado escreveria `null` por cima de dado bom.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const MEETING_ID = "m-1";
const FUNIL = "p-comercial";
const LEAD = "l-42";

const reuniao = {
  data: null as Record<string, unknown> | null,
  isLoading: true,
  isError: false,
};

const mutate = vi.fn();

vi.mock("@/modules/engagement/hooks/useMeetings", () => ({
  useMeeting: () => reuniao,
  useUpdateMeeting: () => ({ mutate, isPending: false }),
}));

/** O que o picker recebeu — é assim que se vê o funil+lead semeados. */
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

const { EditMeetingDialog } = await import(
  "@/modules/engagement/components/agenda/EditMeetingDialog"
);

function reuniaoGravada(over: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    title: "Visita à fábrica",
    description: "Levar catálogo",
    location: "Joinville",
    start_at: "2026-09-01T13:00:00.000Z",
    end_at: "2026-09-01T14:00:00.000Z",
    all_day: false,
    event_type: "meeting",
    status: "scheduled",
    lead_id: LEAD,
    pipeline_id: FUNIL,
    color: null,
    meet_link: null,
    ...over,
  };
}

function elemento() {
  return React.createElement(EditMeetingDialog, {
    meetingId: MEETING_ID,
    open: true,
    onOpenChange: vi.fn(),
  });
}

function montar() {
  render(elemento());
}

/** Para exercitar o que acontece quando o hook devolve dado novo. */
function montarComRerender() {
  const r = render(elemento());
  return {
    rerender: () => act(() => r.rerender(elemento())),
  };
}

beforeEach(() => {
  reuniao.data = null;
  reuniao.isLoading = true;
  reuniao.isError = false;
  mutate.mockClear();
  valorNoPicker = null;
  trocarValor = null;
});

describe("EditMeetingDialog", () => {
  it("reabrir mostra o funil E o lead que estao gravados", () => {
    reuniao.data = reuniaoGravada();
    reuniao.isLoading = false;
    montar();

    // S6: o picker recebe também o negócio semeado da reunião.
    expect(valorNoPicker).toEqual({
      pipelineId: FUNIL,
      leadId: LEAD,
      dealId: null,
    });
    expect(
      (screen.getByLabelText(/Título/) as HTMLInputElement).value,
    ).toBe("Visita à fábrica");
  });

  it("salvar manda o funil junto com o lead", () => {
    reuniao.data = reuniaoGravada();
    reuniao.isLoading = false;
    montar();

    fireEvent.click(screen.getByText("Salvar alterações"));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      id: MEETING_ID,
      lead_id: LEAD,
      pipeline_id: FUNIL,
    });
  });

  it("trocar o lead e salvar grava o par novo", () => {
    reuniao.data = reuniaoGravada();
    reuniao.isLoading = false;
    montar();

    // O picker devolve o par já trocado — é ele quem limpa o lead na troca de
    // funil; aqui o dialog só precisa aceitar e gravar.
    act(() => trocarValor!({ pipelineId: "p-reativacao", leadId: "l-99" }));
    fireEvent.click(screen.getByText("Salvar alterações"));

    expect(mutate.mock.calls[0][0]).toMatchObject({
      lead_id: "l-99",
      pipeline_id: "p-reativacao",
    });
  });

  it("sem lead nao grava funil solto", () => {
    reuniao.data = reuniaoGravada();
    reuniao.isLoading = false;
    montar();

    act(() => trocarValor!({ pipelineId: "p-reativacao", leadId: null }));
    fireEvent.click(screen.getByText("Salvar alterações"));

    expect(mutate.mock.calls[0][0]).toMatchObject({
      lead_id: null,
      pipeline_id: null,
    });
  });

  it("🚨 nao da para salvar enquanto a reuniao nao carregou", () => {
    reuniao.data = null;
    reuniao.isLoading = true;
    montar();

    // Sem formulário semeado o botão nem existe — não há como gravar `null`
    // por cima do que está no banco.
    expect(screen.queryByText("Salvar alterações")).toBeNull();
  });

  it("erro ao carregar a reuniao aparece, e nao um formulario vazio", () => {
    reuniao.isLoading = false;
    reuniao.isError = true;
    montar();

    expect(
      screen.getByText("Não foi possível carregar este evento."),
    ).toBeTruthy();
    expect(screen.queryByText("Salvar alterações")).toBeNull();
  });

  it("reuniao sem funil gravado abre com o par vazio, sem chutar um funil", () => {
    reuniao.data = reuniaoGravada({ lead_id: null, pipeline_id: null });
    reuniao.isLoading = false;
    montar();

    expect(valorNoPicker).toEqual({
      pipelineId: null,
      leadId: null,
      dealId: null,
    });
  });

  it("fim antes do inicio bloqueia a gravacao", () => {
    reuniao.data = reuniaoGravada({
      start_at: "2026-09-01T14:00:00.000Z",
      end_at: "2026-09-01T13:00:00.000Z",
    });
    reuniao.isLoading = false;
    montar();

    expect(screen.getByText("Fim deve ser depois do início")).toBeTruthy();
    fireEvent.click(screen.getByText("Salvar alterações"));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("🚨 data apagada bloqueia a gravacao — `new Date(\"\")` nao passa por `endBeforeStart`", () => {
    // `<input type="datetime-local">` devolve "" quando a pessoa apaga a data
    // para redigitar. Toda comparação com `Invalid Date` é false, então a
    // guarda de "fim antes do início" NÃO pega este caso: sem a checagem
    // própria, o botão fica habilitado e o clique morre num RangeError dentro
    // do handler — salvar vira um botão que não faz nada e não explica.
    reuniao.data = reuniaoGravada();
    reuniao.isLoading = false;
    montar();

    fireEvent.change(screen.getByLabelText(/Início/), {
      target: { value: "" },
    });

    expect(screen.getByText("Informe início e fim")).toBeTruthy();
    // 🚨 A asserção é o botão DESABILITADO, não "mutate não foi chamado".
    // Sem a guarda, `mutate` também não é chamado — mas porque
    // `new Date("").toISOString()` estoura antes, o que é justamente o defeito.
    // Um teste que só olhasse `mutate` passaria pelos dois motivos opostos.
    expect(
      screen.getByText("Salvar alterações").closest("button"),
    ).toBeDisabled();
    fireEvent.click(screen.getByText("Salvar alterações"));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("🚨 erro TRANSIENTE de refetch nao apaga o formulario ja digitado", () => {
    // No TanStack v5 uma falha de refetch em background põe `status: 'error'`
    // MAS preserva o `data`. Testando `isError` antes de `!form`, um soluço de
    // rede trocaria o formulário cheio pela tela de erro e jogaria fora o que
    // a pessoa estava escrevendo.
    reuniao.data = reuniaoGravada();
    reuniao.isLoading = false;
    const { rerender } = montarComRerender();

    fireEvent.change(screen.getByLabelText(/Título/), {
      target: { value: "Título que eu estava escrevendo" },
    });

    // O refetch falha MAS o TanStack preserva o `data` — é este par
    // (`isError` true + `data` presente) que o modo de falha exige.
    reuniao.isError = true;
    rerender();

    expect(
      (screen.getByLabelText(/Título/) as HTMLInputElement).value,
    ).toBe("Título que eu estava escrevendo");
    expect(screen.queryByText("Não foi possível carregar este evento.")).toBeNull();
  });

  it("🚨 refetch com dado NOVO nao sobrescreve o que a pessoa digitou", () => {
    reuniao.data = reuniaoGravada();
    reuniao.isLoading = false;
    const { rerender } = montarComRerender();

    fireEvent.change(screen.getByLabelText(/Título/), {
      target: { value: "Meu texto" },
    });

    // Chega uma versão nova do servidor (mesmo id, `updated_at` diferente).
    reuniao.data = reuniaoGravada({
      title: "Título de outra aba",
      updated_at: "2026-09-02T00:00:00.000Z",
    });
    rerender();

    expect((screen.getByLabelText(/Título/) as HTMLInputElement).value).toBe(
      "Meu texto",
    );
  });

  it("avisa que salvar vai desvincular o lead que a reuniao tinha", () => {
    reuniao.data = reuniaoGravada();
    reuniao.isLoading = false;
    montar();

    expect(screen.queryByText(/deixará de estar vinculada/)).toBeNull();

    act(() => trocarValor!({ pipelineId: "p-reativacao", leadId: null }));

    expect(screen.getByText(/deixará de estar vinculada/)).toBeTruthy();
  });

  it("titulo vazio bloqueia a gravacao", () => {
    reuniao.data = reuniaoGravada();
    reuniao.isLoading = false;
    montar();

    fireEvent.change(screen.getByLabelText(/Título/), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("Salvar alterações"));

    expect(mutate).not.toHaveBeenCalled();
  });
});
