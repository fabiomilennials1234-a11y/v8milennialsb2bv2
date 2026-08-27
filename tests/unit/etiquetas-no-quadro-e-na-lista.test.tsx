/**
 * Etiquetar sem abrir a ficha — no card do quadro e na linha da lista.
 *
 * ── O QUE ESTAVA QUEBRADO ─────────────────────────────────────────────────
 * As duas telas DESENHAVAM as etiquetas do lead e nenhuma das duas deixava
 * mexer: tirar uma etiqueta que não valia mais exigia abrir a ficha, um lead
 * por vez. "Não existe onde clicar" foi o relato literal.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *   1. O botão escreve no id do LEAD. No card do quadro, `lead.id` é o id da
 *      ENTRADA no funil — pendurar etiqueta nele escreveria num lead que não
 *      existe (ou, pior, em outro). Sem `leadId` o botão não pode aparecer.
 *   2. O clique no botão NÃO abre o card por trás. O card inteiro é clicável e
 *      arrastável; sem `stopPropagation` o popover abre junto com o painel do
 *      Negócio por cima dele.
 *   3. O banco só é consultado quando alguém abre. Num board de 200 cards, um
 *      hook no gatilho seriam 200 consultas a `lead_tags` para desenhar 200
 *      botões que ninguém clicou.
 *   4. Dá para TIRAR de lá, e pelo id da junção — que é a metade do pedido que
 *      não existia em tela nenhuma dessas duas.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Só o banco é mockado ────────────────────────────────────────────────────
const presas = vi.hoisted(() => ({
  lista: [] as Array<{
    id: string;
    tag_id: string;
    tag: { id: string; name: string; color: string | null } | null;
  }>,
  chamadas: 0,
  /** O id com que a tela pediu as etiquetas — é o que prova a fiação. */
  pedidoPara: null as string | null | undefined,
}));
const doOrg = vi.hoisted(() => ({
  lista: [] as Array<{ id: string; name: string; color: string | null }>,
}));

const adicionar = vi.fn().mockResolvedValue({ id: "lt-novo", tag_id: "t-1" });
const remover = vi.fn().mockResolvedValue({ leadId: "lead-1", removidas: 1 });
const criar = vi.fn().mockResolvedValue({ id: "t-criada", name: "Inédita" });
const registrar = vi.fn();

vi.mock("@/modules/leads/hooks/lead/useLeadTagsAttached", () => ({
  useLeadTagsAttached: (leadId?: string | null) => {
    presas.chamadas += 1;
    presas.pedidoPara = leadId;
    return { data: presas.lista, isLoading: false };
  },
  useAddLeadTag: () => ({ mutateAsync: adicionar, isPending: false }),
  useRemoveLeadTag: () => ({ mutateAsync: remover, isPending: false }),
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({
  useTags: () => ({ data: doOrg.lista, isLoading: false }),
  useCreateTag: () => ({ mutateAsync: criar, isPending: false }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => registrar }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ role: "admin" }) }));
/* Os dois vizinhos que o card compacto monta também escrevem, e cada um puxa
   `useQueryClient`/gates. Esta suíte renderiza sem provider nenhum, e o assunto
   dela é etiqueta: eles entram como marcador para o card poder montar. */
vi.mock("@/modules/leads/components/leads/card/LeadCardQualificationPopover", () => ({
  LeadCardQualificationPopover: () => <span data-testid="qualificacao" />,
}));
vi.mock("@/modules/leads/components/leads/card/LeadCardChecklistPopover", () => ({
  LeadCardChecklistPopover: () => <span data-testid="checklists" />,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { LeadEtiquetasPopover } from "@/modules/leads/components/etiquetas/LeadEtiquetasPopover";
import { LeadCardCompact } from "@/modules/leads/components/leads/card/LeadCardCompact";
import { LeadListRow } from "@/modules/leads/components/leads/LeadListRow";

beforeEach(() => {
  presas.lista = [];
  presas.chamadas = 0;
  presas.pedidoPara = null;
  doOrg.lista = [
    { id: "t-1", name: "Ouro", color: "#f0a" },
    { id: "t-2", name: "Recompra", color: null },
  ];
  adicionar.mockClear();
  remover.mockClear();
  registrar.mockClear();
});

/**
 * Pelo `aria-label`, e não por `role` + nome: a linha da lista é ela própria um
 * `role="button"`, e o nome acessível dela inclui o texto dos filhos — então
 * `getByRole("button", { name: /etiqueta/i })` casa a linha INTEIRA junto com o
 * gatilho de dentro dela.
 */
function abrir() {
  fireEvent.click(screen.getByLabelText(/adicionar etiqueta|editar etiquetas/i));
}

describe("O botão de etiquetas do quadro e da lista", () => {
  it("só consulta o banco quando alguém abre — o gatilho não custa consulta", async () => {
    render(<LeadEtiquetasPopover leadId="lead-1" />);

    expect(presas.chamadas).toBe(0);

    abrir();

    await waitFor(() => expect(presas.chamadas).toBeGreaterThan(0));
  });

  it("não deixa o clique chegar ao card por trás", () => {
    const abrirONegocio = vi.fn();
    render(
      <div onClick={abrirONegocio}>
        <LeadEtiquetasPopover leadId="lead-1" />
      </div>,
    );

    abrir();

    expect(abrirONegocio).not.toHaveBeenCalled();
  });

  it("pendura no lead que recebeu, e não em outro id qualquer", async () => {
    render(<LeadEtiquetasPopover leadId="lead-1" />);
    abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Ouro" }));

    await waitFor(() => expect(adicionar).toHaveBeenCalledTimes(1));
    expect(adicionar).toHaveBeenCalledWith({ leadId: "lead-1", tagId: "t-1" });
  });

  /**
   * Marcar não pode fechar: a lista de dentro é o ÚNICO lugar onde o resultado
   * aparece nestas duas telas, e quem abre quase sempre mexe em mais de uma. Se
   * fechasse, tirar a etiqueta errada que acabou de entrar exigiria reabrir.
   */
  it("continua aberto depois de pendurar — dá para mexer em mais de uma", async () => {
    render(<LeadEtiquetasPopover leadId="lead-1" />);
    abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Ouro" }));

    await waitFor(() => expect(adicionar).toHaveBeenCalledTimes(1));
    expect(screen.getByPlaceholderText(/buscar etiqueta/i)).toBeInTheDocument();
  });

  /**
   * A metade que faltava: aqui não há faixa de pílulas por fora onde pendurar o
   * "×" — se o seletor não listar as presas, dá para adicionar e não dá para
   * tirar.
   */
  it("lista as etiquetas do lead com o × e remove pelo id da JUNÇÃO", async () => {
    presas.lista = [{ id: "lt-9", tag_id: "t-1", tag: { id: "t-1", name: "Ouro", color: "#f0a" } }];
    render(<LeadEtiquetasPopover leadId="lead-1" quantidade={1} />);
    abrir();

    fireEvent.click(await screen.findByRole("button", { name: /remover a etiqueta ouro/i }));

    await waitFor(() => expect(remover).toHaveBeenCalledTimes(1));
    expect(remover).toHaveBeenCalledWith({ leadTagId: "lt-9", leadId: "lead-1" });
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-1", action: "tag_removed" }),
    );
  });
});

/**
 * A fiação — que é onde este trabalho tem como escrever na pessoa errada.
 *
 * No card do quadro, `lead.id` é a ENTRADA no funil e `lead.leadId` é a pessoa.
 * Os dois são uuid e estão os dois na mão. Passar o primeiro não dá erro de
 * tipo, não dá erro em tela: dá um INSERT em `lead_tags` com um `lead_id` que
 * não existe — ou que existe e é de outro alguém.
 */
describe("Quem o card e a linha mandam etiquetar", () => {
  const config = {
    showContact: true, showValue: true, showDate: true,
    showProducts: false, showMeetLink: false, showNotes: false,
  };
  const origem = { bg: "#111", text: "#eee", label: "WhatsApp" };

  function cardDoQuadro(lead: Record<string, unknown>) {
    return (
      <LeadCardCompact
        lead={lead as Parameters<typeof LeadCardCompact>[0]["lead"]}
        config={config}
        origin={origem}
        urgency={null}
        dateIndicator={null}
        parsedDate={null}
        menuItems={null}
      />
    );
  }

  it("o card do quadro pede as etiquetas do LEAD, não da entrada no funil", async () => {
    render(cardDoQuadro({ id: "entrada-77", leadId: "lead-1", name: "Ana", tags: [] }));

    abrir();

    await waitFor(() => expect(presas.pedidoPara).toBe("lead-1"));
  });

  it("sem o id do lead, o card não desenha botão nenhum — não há em quem pendurar", () => {
    render(cardDoQuadro({ id: "entrada-77", leadId: null, name: "Ana", tags: [] }));

    expect(screen.queryByLabelText(/adicionar etiqueta|editar etiquetas/i)).toBeNull();
  });

  it("a linha da lista pede pelo id do próprio lead", async () => {
    render(
      <LeadListRow
        lead={{ id: "lead-1", name: "Ana", lead_tags: [] } as Parameters<typeof LeadListRow>[0]["lead"]}
        selected={false}
        onToggleSelect={vi.fn()}
        onOpen={vi.fn()}
        createdLabel="hoje"
        originLabel="WhatsApp"
        originClassName=""
      />,
    );

    abrir();

    await waitFor(() => expect(presas.pedidoPara).toBe("lead-1"));
  });
});
