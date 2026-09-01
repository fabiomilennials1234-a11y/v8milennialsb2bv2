/**
 * As anotações antigas voltam a ser lidas de DENTRO do Negócio.
 *
 * ── O QUE ESTE ARQUIVO GUARDA ─────────────────────────────────────────────
 * `lead_history` com `action = 'note_added'` guarda 1.250 anotações escritas à
 * mão pela equipe em 851 leads (prod, 01/09/2026) — pelo bloco de notas do chat
 * e pelos modais antigos de Confirmação e Propostas. Elas NUNCA tiveram caminho
 * de tela dentro do painel do Negócio: `useDealCardData` lia
 * `pipeline_stage_events`, `activities` e `follow_ups`, e nenhuma linha do
 * `deal-card/` tocava `lead_history`. Para **750 leads que têm negócio e nenhum
 * comentário vivo**, o bloco abria dizendo "Nenhum comentário ainda" enquanto o
 * texto existia no banco.
 *
 * Elas entram no bloco "Comentários" que já existe, e não numa aba nova: é a
 * decisão do dono do produto de 24/08 registrada em `DealCard.tsx:703-713`
 * ("bloco FIXO no pé da aba, não uma quarta sub-aba"). Um teste que aceitasse
 * uma aba passaria batido por cima dessa decisão.
 *
 * ── AS DUAS ASSERÇÕES QUE VALEM MAIS QUE AS OUTRAS ───────────────────────
 * 1. **A ORDEM.** `DealCardComments` desenha na ordem em que recebe. Antes
 *    havia uma fonte só e a ordem vinha de graça do `.order()` da consulta;
 *    agora são duas concatenadas. Sem `sort` no painel a lista sai com todos os
 *    comentários e depois todas as notas — e nenhum outro teste pega isso.
 * 2. **SOMENTE LEITURA.** `lead_history` é log e não tem caminho de edição em
 *    lugar nenhum do produto. Uma nota que ofereça "Editar" promete o que o
 *    sistema não cumpre.
 *
 * O componente é puro (`DealCard.tsx` está no grafo de `/preview.html`), então
 * o que se testa aqui é o FORMATO que o painel monta — mais o leitor do formato
 * da nota, que é onde o autor se separa do corpo.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { DealCardComments } from "@/modules/leads/components/deal-card/DealCardComments";
import type { DealCardComentario } from "@/modules/leads/components/deal-card/types";
import { lerNotaDoHistorico } from "@/shared/format/nota-de-historico";

function comentario(over: Partial<DealCardComentario> = {}): DealCardComentario {
  return {
    id: "c1",
    corpo: "Comentário de hoje.",
    autor: "Luiza Andrade",
    autorAvatar: null,
    criadoEm: "2026-08-30T12:00:00.000Z",
    editadoEm: null,
    deOutroNegocio: null,
    podeEditar: true,
    podeApagar: true,
    origem: "comentario",
    ...over,
  };
}

function nota(over: Partial<DealCardComentario> = {}): DealCardComentario {
  return {
    id: "nota:h1",
    corpo: "cliente abordado sem retorno",
    autor: "Weberth",
    autorAvatar: null,
    criadoEm: "2026-02-20T10:00:00.000Z",
    editadoEm: null,
    deOutroNegocio: null,
    podeEditar: false,
    podeApagar: false,
    origem: "nota",
    ...over,
  };
}

/** As linhas da lista, na ordem em que o DOM as tem. */
function linhas() {
  return screen.getAllByRole("listitem");
}

describe("lerNotaDoHistorico — o autor vem grudado no texto", () => {
  /**
   * O formato não é convenção: `useLogLeadAction.ts:108-110` grava
   * `` `${userName}: ${description}` ``. Medido sobre as 1.250 linhas de prod:
   * zero sem `:`, zero com corpo vazio, zero com prefixo acima de 40 chars.
   */
  it("separa autor e corpo no PRIMEIRO dois-pontos", () => {
    expect(lerNotaDoHistorico("Weberth: cliente abordado sem retorno")).toEqual({
      autor: "Weberth",
      corpo: "cliente abordado sem retorno",
    });
  });

  it("não parte o corpo quando ele também tem dois-pontos", () => {
    // Cortar no ÚLTIMO `:` jogaria "orçamento" para o campo de autor.
    expect(lerNotaDoHistorico("Bruno: orçamento: 3 mil")).toEqual({
      autor: "Bruno",
      corpo: "orçamento: 3 mil",
    });
  });

  it("sem dois-pontos, devolve o texto INTEIRO como corpo — perder texto é pior que ficar sem autor", () => {
    expect(lerNotaDoHistorico("visita marcada para quinta")).toEqual({
      autor: null,
      corpo: "visita marcada para quinta",
    });
  });

  it("dois-pontos sem nada depois não é 'autor: texto' — devolve inteiro", () => {
    expect(lerNotaDoHistorico("Reunião:")).toEqual({
      autor: null,
      corpo: "Reunião:",
    });
  });

  it("aguenta nulo e vazio sem estourar", () => {
    expect(lerNotaDoHistorico(null)).toEqual({ autor: null, corpo: "" });
    expect(lerNotaDoHistorico("   ")).toEqual({ autor: null, corpo: "" });
  });
});

describe("Anotações antigas no bloco do Negócio", () => {
  it("mostra o texto e o autor de uma anotação que só existia em lead_history", () => {
    render(<DealCardComments comentarios={[nota()]} />);

    expect(screen.getByText("cliente abordado sem retorno")).toBeInTheDocument();
    expect(screen.getByText("Weberth")).toBeInTheDocument();
  });

  it("marca a anotação com o selo que explica por que ela não se edita", () => {
    render(<DealCardComments comentarios={[nota(), comentario()]} />);

    const selos = screen.getAllByText("Anotação");
    expect(selos).toHaveLength(1);

    // O selo está NA linha da nota, não solto na tela nem no comentário.
    const linhaDaNota = screen.getByText("cliente abordado sem retorno").closest("li");
    expect(linhaDaNota).not.toBeNull();
    expect(within(linhaDaNota as HTMLElement).getByText("Anotação")).toBeInTheDocument();
  });

  it("anotação é SOMENTE LEITURA — não oferece editar nem apagar", () => {
    render(
      <DealCardComments
        comentarios={[nota()]}
        onEditar={async () => {}}
        onApagar={async () => {}}
      />,
    );

    // Os callbacks existem; quem recusa é o `podeEditar`/`podeApagar` da linha.
    // Se um dia a nota vier editável, é aqui que estoura.
    expect(screen.queryByRole("button", { name: /editar comentário/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apagar comentário/i })).not.toBeInTheDocument();
  });

  it("o comentário ao lado CONTINUA editável — a nota não contaminou o resto", () => {
    render(
      <DealCardComments
        comentarios={[nota(), comentario()]}
        onEditar={async () => {}}
        onApagar={async () => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /editar comentário/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apagar comentário/i })).toBeInTheDocument();
  });

  /**
   * 🚨 O caso que justifica o arquivo. Duas fontes concatenadas, ordenadas por
   * data no painel: uma nota de agosto tem de vir ANTES de um comentário de
   * fevereiro. Sem o `sort` do `DealCardPanel` a lista sairia agrupada por
   * fonte, e a leitura viraria uma linha do tempo mentirosa.
   */
  it("intercala nota e comentário por DATA, não por fonte", () => {
    const mistura: DealCardComentario[] = [
      nota({ id: "nota:novo", corpo: "nota de agosto", criadoEm: "2026-08-26T17:59:00.000Z" }),
      comentario({ id: "c-meio", corpo: "comentário de maio", criadoEm: "2026-05-10T09:00:00.000Z" }),
      nota({ id: "nota:velho", corpo: "nota de fevereiro", criadoEm: "2026-02-20T10:00:00.000Z" }),
    ].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());

    render(<DealCardComments comentarios={mistura} />);

    const textos = linhas().map((li) => li.textContent ?? "");
    expect(textos[0]).toContain("nota de agosto");
    expect(textos[1]).toContain("comentário de maio");
    expect(textos[2]).toContain("nota de fevereiro");
  });

  it("preserva a quebra de linha da anotação — nota de vendedor vem em lista", () => {
    const corpo = "Pedido 1195\naguardando NF\nTransportadora coleta 08/05";
    render(<DealCardComments comentarios={[nota({ corpo })]} />);

    // `getByText` normaliza espaço, então a asserção é sobre o nó e o estilo
    // que preserva a quebra — é ele que faz a diferença na tela.
    const paragrafo = screen.getByText(/Transportadora coleta 08\/05/);
    expect(paragrafo).toHaveClass("whitespace-pre-wrap");
    expect(paragrafo.textContent).toBe(corpo);
  });

  it("o bloco deixa de anunciar vazio quando só há anotações — o caso dos 750 leads", () => {
    render(<DealCardComments comentarios={[nota()]} />);

    expect(screen.queryByText("Nenhum comentário ainda.")).not.toBeInTheDocument();
  });
});
