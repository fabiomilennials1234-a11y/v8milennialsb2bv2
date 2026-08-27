/**
 * O histórico de comentários na ficha da PESSOA.
 *
 * ── O defeito que este arquivo existe para não deixar voltar ──────────────
 * O merge de 23/08 (`cdd1d096`, separação Lead↔Negócio) desmontou o
 * `LeadDetailDialogV2` e, com ele, a coluna "Histórico & comentários" que era
 * a única superfície onde o corpo de um comentário aparecia. O conserto de
 * 24/08 devolveu o bloco só dentro do painel do NEGÓCIO — e quem abre uma
 * pessoa pela aba de Leads continuou sem ver nada.
 *
 * Medido em prod em 25/08, e é o tamanho do buraco: **2.890 comentários vivos,
 * 2.864 anteriores ao merge, em 2.089 leads**. Nenhum foi apagado; todos
 * ficaram sem tela.
 *
 * Duas causas independentes com o MESMO sintoma, e as duas são cobertas aqui:
 *
 *   1. **O corpo nunca esteve em `lead_history`.** A linha de histórico traz
 *      `description = "Comentário adicionado"` nas 2.909 linhas, e um
 *      `metadata.preview` cortado em 120 caracteres — que mutila 747 delas
 *      (25,7%; o maior comentário tem 1.885). Ler o comentário da timeline
 *      devolve um histórico sem histórico.
 *   2. **A timeline pagina em 20 e esta ficha nunca chama `loadMore`.** Como
 *      73% de `lead_history` é tráfego de WhatsApp, o comentário antigo cai
 *      fora da janela: **401 comentários (13,8%) e 144 leads inteiros** não
 *      têm um único comentário entre os 20 eventos mais recentes.
 *
 * A defesa contra as duas é a mesma: a ficha lê `lead_comments` DIRETO.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";

import { LeadCardHistory } from "@/modules/leads/components/lead-card/LeadCardHistory";
import type { LeadCardEvent } from "@/modules/leads/components/lead-card/types";

// ── Mocks do hook de dados ──────────────────────────────────────────────────
const leadRef: { value: Record<string, unknown> | null } = { value: null };
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadDetail", () => ({
  useLeadDetail: () => ({ lead: leadRef.value, isLoading: false, visibility: "exists" }),
}));

const eventosRef: { value: unknown[] } = { value: [] };
vi.mock("@/modules/leads/hooks/useLeadTimeline", () => ({
  useLeadTimeline: () => ({
    data: {
      events: eventosRef.value,
      metrics: { total: 0, daysSinceFirstContact: 0, lastContact: null, topSource: null },
      hasMore: false,
      totalFiltered: 0,
    },
  }),
}));

const comentariosRef: { value: unknown[] } = { value: [] };
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadComments", () => ({
  useLeadComments: () => ({ data: comentariosRef.value }),
  useCreateLeadComment: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useUpdateLeadComment: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDeleteLeadComment: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));

const identidadeRef: { membro: string | null; papel: string } = { membro: "membro-1", papel: "member" };
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({
    organizationId: "org-1",
    teamMemberId: identidadeRef.membro,
    role: identidadeRef.papel,
  }),
  useTeamMembers: () => ({ data: [] }),
}));

vi.mock("@/modules/leads/hooks/useLeadsDeals", () => ({ useLeadsDeals: () => ({ data: {} }) }));
// Os produtos de cada negócio saem de uma consulta própria. Este arquivo usa
// `renderHook` sem `QueryClientProvider` — como todos os outros hooks de dado
// aqui, ele é dublado, senão o `useQuery` de dentro lança "No QueryClient set".
vi.mock("@/modules/leads/components/lead-card/useProdutosPorNegocio", () => ({
  useProdutosPorNegocio: () => ({ data: {} }),
}));
vi.mock("@/modules/leads/hooks/useLeadsSalesMetrics", () => ({
  useLeadsSalesMetrics: () => ({ data: {} }),
}));
vi.mock("@/modules/leads/hooks/useLeadsCarteiraMetrics", () => ({
  useLeadsCarteiraMetrics: () => ({ data: {} }),
}));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useLeadCustomFields: () => ({ data: [] }),
  useLeadCustomFieldValues: () => ({ data: [] }),
}));

import { useLeadCardData } from "@/modules/leads/components/lead-card/useLeadCardData";

// ── Fábricas ────────────────────────────────────────────────────────────────

/** O texto real de um comentário de prod — com quebra de linha e > 120 chars. */
const CORPO_LONGO =
  "Em contato com o Edson: ele pediu para retornar no dia 04/09/2026, porque está sem " +
  "funcionários no galpão.\nCombinei de mandar a tabela de preços antes, e ele confirmou " +
  "que quem decide é o irmão.";

/**
 * Um pedaço que mora DEPOIS do caractere 120 — o corte do `metadata.preview`.
 * Encontrá-lo na tela é a prova de que o corpo veio inteiro de `lead_comments`,
 * e não da linha de histórico. `getByText` normaliza espaço, então a asserção
 * usa regex: `CORPO_LONGO` tem quebra de linha.
 */
const FIM_DO_CORPO = /que quem decide é o irmão/;

function comentario(over: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    organization_id: "org-1",
    lead_id: "lead-1",
    author_user_id: "user-1",
    author_team_member_id: "membro-1",
    body: CORPO_LONGO,
    created_at: "2026-07-16T17:22:05.000Z",
    updated_at: null,
    deleted_at: null,
    deleted_by: null,
    pipeline_entry_id: null,
    author: { id: "membro-1", name: "Maria", avatar_url: null },
    ...over,
  };
}

/** A linha de histórico que o banco grava junto — sem o corpo. */
function eventoDeHistorico(over: Record<string, unknown> = {}) {
  return {
    id: "h-1",
    action: "comment_added",
    description: "Comentário adicionado",
    source: "manual",
    metadata: { preview: CORPO_LONGO.slice(0, 120), comment_id: "c-1" },
    entity_type: null,
    entity_id: null,
    created_at: "2026-07-16T17:22:05.000Z",
    created_by: "user-1",
    ...over,
  };
}

beforeEach(() => {
  leadRef.value = { id: "lead-1", name: "Bufalare Cavalgare", organization_id: "org-1" };
  eventosRef.value = [];
  comentariosRef.value = [];
  identidadeRef.membro = "membro-1";
  identidadeRef.papel = "member";
});

describe("useLeadCardData — o comentário chega inteiro, e não pela timeline", () => {
  it("o corpo vem de lead_comments, não do 'Comentário adicionado' do histórico", () => {
    comentariosRef.value = [comentario()];
    eventosRef.value = [eventoDeHistorico()];

    const { result } = renderHook(() => useLeadCardData("lead-1", true));
    const comentarios = result.current.data!.historico.filter((e) => e.comentario);

    expect(comentarios).toHaveLength(1);
    expect(comentarios[0].comentario!.corpo).toBe(CORPO_LONGO);
    // A prova de que não é o preview de 120 caracteres do `metadata`.
    expect(comentarios[0].comentario!.corpo.length).toBeGreaterThan(120);
  });

  it("não duplica: a linha 'comment_added' do histórico sai do lugar dela", () => {
    comentariosRef.value = [comentario()];
    eventosRef.value = [eventoDeHistorico()];

    const { result } = renderHook(() => useLeadCardData("lead-1", true));
    const historico = result.current.data!.historico;

    expect(historico).toHaveLength(1);
    expect(historico.some((e) => e.texto === "Comentário adicionado")).toBe(false);
  });

  it("aparece mesmo fora da janela de 20 eventos — a causa que só o dado revela", () => {
    // A timeline devolve 20 mensagens de WhatsApp e NENHUM comment_added: é
    // exatamente o estado dos 144 leads medidos em prod.
    eventosRef.value = Array.from({ length: 20 }, (_, i) => ({
      id: `w-${i}`,
      action: "whatsapp_sent",
      description: "Mensagem enviada",
      source: "manual",
      metadata: null,
      entity_type: null,
      entity_id: null,
      created_at: `2026-08-2${i % 10}T12:00:00.000Z`,
      created_by: null,
    }));
    comentariosRef.value = [comentario()];

    const { result } = renderHook(() => useLeadCardData("lead-1", true));

    expect(result.current.data!.historico.filter((e) => e.comentario)).toHaveLength(1);
  });

  it("apagado é soft-delete e não volta para a tela", () => {
    comentariosRef.value = [comentario({ deleted_at: "2026-08-01T10:00:00.000Z" })];

    const { result } = renderHook(() => useLeadCardData("lead-1", true));

    expect(result.current.data!.historico).toHaveLength(0);
  });

  it("só o autor edita; admin também apaga", () => {
    comentariosRef.value = [comentario({ author_team_member_id: "outro-membro" })];
    identidadeRef.papel = "admin";

    const { result } = renderHook(() => useLeadCardData("lead-1", true));
    const c = result.current.data!.historico[0].comentario!;

    expect(c.podeEditar).toBe(false);
    expect(c.podeApagar).toBe(true);
  });

  it("sem membro conhecido a ficha falha FECHADA — ninguém edita nem apaga", () => {
    comentariosRef.value = [comentario()];
    identidadeRef.membro = null;

    const { result } = renderHook(() => useLeadCardData("lead-1", true));
    const c = result.current.data!.historico[0].comentario!;

    expect(c.podeEditar).toBe(false);
    expect(c.podeApagar).toBe(false);
  });
});

// ── O desenho ───────────────────────────────────────────────────────────────

function eventoComComentario(over: Partial<LeadCardEvent> = {}): LeadCardEvent {
  return {
    id: "comentario:c-1",
    tipo: "comentario",
    texto: "Comentário",
    autor: "Maria",
    quando: "2026-07-16T17:22:05.000Z",
    comentario: {
      id: "c-1",
      corpo: CORPO_LONGO,
      editadoEm: null,
      podeEditar: true,
      podeApagar: true,
    },
    ...over,
  };
}

describe("LeadCardHistory — o comentário no Histórico", () => {
  it("desenha o texto inteiro, não uma frase de sistema", () => {
    render(<LeadCardHistory eventos={[eventoComComentario()]} />);

    // `FIM_DO_CORPO` mora além do caractere 120 — se a tela estivesse
    // desenhando o `metadata.preview` do histórico, ele não estaria aqui.
    expect(screen.getByText(FIM_DO_CORPO)).toBeInTheDocument();
    expect(screen.queryByText("Comentário adicionado")).toBeNull();
  });

  it("o chip Comentários filtra e conta os de verdade", () => {
    const mensagem: LeadCardEvent = {
      id: "w-1",
      tipo: "mensagem",
      texto: "Mensagem enviada",
      autor: null,
      quando: "2026-08-20T12:00:00.000Z",
    };
    render(<LeadCardHistory eventos={[mensagem, eventoComComentario()]} />);

    fireEvent.click(screen.getByRole("button", { name: /^Comentários/ }));

    expect(screen.getByText(FIM_DO_CORPO)).toBeInTheDocument();
    expect(screen.queryByText("Mensagem enviada")).toBeNull();
  });

  it("sem onComentar não oferece caixa de escrever — o INSERT falharia", () => {
    render(<LeadCardHistory eventos={[eventoComComentario()]} />);

    expect(screen.queryByRole("button", { name: /^Comentário$/ })).toBeNull();
  });

  it("publicar NÃO esvazia a caixa quando o gravar falha", async () => {
    const onComentar = vi.fn().mockRejectedValue(new Error("comentario-nao-publicado"));
    render(<LeadCardHistory eventos={[]} onComentar={onComentar} />);

    fireEvent.click(screen.getByRole("button", { name: /^Comentário$/ }));
    const campo = screen.getByLabelText("Escrever comentário");
    fireEvent.change(campo, { target: { value: "não me perca" } });
    fireEvent.click(screen.getByRole("button", { name: /^Comentar$/ }));

    await waitFor(() => expect(onComentar).toHaveBeenCalledWith("não me perca"));
    expect(screen.getByLabelText("Escrever comentário")).toHaveValue("não me perca");
  });

  it("quem não é autor nem admin não vê as ações", () => {
    render(
      <LeadCardHistory
        eventos={[
          eventoComComentario({
            comentario: {
              id: "c-1",
              corpo: CORPO_LONGO,
              editadoEm: null,
              podeEditar: false,
              podeApagar: false,
            },
          }),
        ]}
        onEditarComentario={vi.fn()}
        onApagarComentario={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Editar comentário")).toBeNull();
    expect(screen.queryByLabelText("Apagar comentário")).toBeNull();
  });

  it("editar manda o texto novo e fecha a caixa", async () => {
    const onEditar = vi.fn().mockResolvedValue(undefined);
    render(<LeadCardHistory eventos={[eventoComComentario()]} onEditarComentario={onEditar} />);

    fireEvent.click(screen.getByLabelText("Editar comentário"));
    const campo = screen.getByLabelText("Editar comentário");
    fireEvent.change(campo, { target: { value: "texto corrigido" } });
    fireEvent.click(screen.getByRole("button", { name: /^Salvar$/ }));

    await waitFor(() => expect(onEditar).toHaveBeenCalledWith("c-1", "texto corrigido"));
  });
});
