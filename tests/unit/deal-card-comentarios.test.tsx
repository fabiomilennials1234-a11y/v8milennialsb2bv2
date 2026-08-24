/**
 * Os comentários vivem DENTRO do negócio.
 *
 * ── O que este arquivo guarda ─────────────────────────────────────────────
 * Entre 04/08/2026 (`88f87146`) e 24/08/2026 o produto ficou sem nenhum
 * caminho de tela para ler ou escrever comentário: o `DealDetailDialog`, que
 * montava a coluna `LeadActivityColumn`, saiu das cinco telas junto com o
 * redesenho de duas colunas, e o painel novo nunca ganhou o bloco. Os 2.885
 * comentários gravados continuaram no banco, invisíveis.
 *
 * A regressão foi silenciosa porque nenhum teste afirmava que o bloco existe —
 * `deal-card.test.tsx` cobre ladrilhos, etapas, dinheiro e anotação, e todos
 * continuaram verdes com os comentários fora da tela. É esse buraco que os
 * casos abaixo fecham.
 *
 * O componente é puro de propósito (`DealCard.tsx` está no grafo de
 * `/preview.html`, e `preview-cards-sem-banco` reprova qualquer arquivo
 * alcançável dali que toque banco), então quem testa comportamento de escrita
 * testa os CALLBACKS — que é exatamente a costura que o painel liga.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DealCardComments } from "@/modules/leads/components/deal-card/DealCardComments";
import type { DealCardComentario } from "@/modules/leads/components/deal-card/types";

function comentario(over: Partial<DealCardComentario> = {}): DealCardComentario {
  return {
    id: "c1",
    corpo: "Cliente pediu prazo de 30 dias.",
    autor: "Luiza Andrade",
    autorAvatar: null,
    criadoEm: "2026-08-22T17:32:00.000Z",
    editadoEm: null,
    deOutroNegocio: null,
    podeEditar: false,
    podeApagar: false,
    ...over,
  };
}

/** Mesma formatação do componente — assertar string crua quebraria por fuso. */
function comoNaTela(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function caixaDeEscrever() {
  return screen.getByRole("textbox", { name: /escrever comentário/i });
}

describe("Comentários no painel do Negócio — histórico", () => {
  it("mostra texto, autor e data/hora de cada comentário", () => {
    render(
      <DealCardComments
        comentarios={[
          comentario({
            id: "c1",
            corpo: "Comprador pediu para refazer com prazo de 30 dias.",
            autor: "Luiza Andrade",
            criadoEm: "2026-08-22T17:32:00.000Z",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Comprador pediu para refazer com prazo de 30 dias.")).toBeInTheDocument();
    expect(screen.getByText("Luiza Andrade")).toBeInTheDocument();
    expect(screen.getByText(comoNaTela("2026-08-22T17:32:00.000Z"))).toBeInTheDocument();
  });

  it("desce do mais recente para o mais antigo, na ordem em que recebe", () => {
    render(
      <DealCardComments
        comentarios={[
          comentario({ id: "novo", corpo: "escrito hoje", criadoEm: "2026-08-22T17:32:00.000Z" }),
          comentario({ id: "velho", corpo: "escrito em junho", criadoEm: "2026-06-04T14:20:00.000Z" }),
        ]}
      />,
    );

    const itens = Array.from(document.querySelectorAll("[data-comentario-id]"));
    expect(itens.map((n) => n.getAttribute("data-comentario-id"))).toEqual(["novo", "velho"]);
  });

  it("conta quantos são", () => {
    render(
      <DealCardComments
        comentarios={[comentario({ id: "a" }), comentario({ id: "b" }), comentario({ id: "c" })]}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("diz que não há nada, em vez de abrir num branco sem explicação", () => {
    render(<DealCardComments comentarios={[]} />);

    expect(screen.getByText(/nenhum comentário ainda/i)).toBeInTheDocument();
  });

  it("marca 'editado' só no que foi editado", () => {
    render(
      <DealCardComments
        comentarios={[
          comentario({ id: "mexido", editadoEm: "2026-08-22T18:00:00.000Z" }),
          comentario({ id: "intacto", editadoEm: null }),
        ]}
      />,
    );

    expect(screen.getAllByText(/^editado$/i)).toHaveLength(1);
  });
});

describe("Comentários no painel do Negócio — de qual negócio é cada um", () => {
  /**
   * 4.948 dos 40.903 leads de prod têm mais de um negócio. Sem o selo, um
   * comentário escrito na negociação de setembro apareceria dentro do upsell de
   * dezembro parecendo ter sido dito sobre ELE. O selo é a diferença entre
   * "mostrar tudo" e "misturar tudo".
   */
  it("põe selo no que veio de outro negócio do mesmo lead", () => {
    render(
      <DealCardComments
        comentarios={[comentario({ id: "c3", deOutroNegocio: "Primeira compra" })]}
      />,
    );

    expect(screen.getByText("Primeira compra")).toBeInTheDocument();
  });

  it("NÃO põe selo no comentário deste negócio nem no comentário do lead", () => {
    render(
      <DealCardComments
        comentarios={[
          comentario({ id: "daqui", corpo: "deste negócio", deOutroNegocio: null }),
          comentario({ id: "dolead", corpo: "do lead, sem vínculo", deOutroNegocio: null }),
        ]}
      />,
    );

    // O selo é o único elemento com `title` de negócio — não existe nenhum.
    expect(document.querySelector('[title^="Escrito no negócio"]')).toBeNull();
  });
});

describe("Comentários no painel do Negócio — escrever", () => {
  it("publica o texto aparado e esvazia a caixa", async () => {
    const onComentar = vi.fn().mockResolvedValue(undefined);
    render(<DealCardComments comentarios={[]} onComentar={onComentar} />);

    const campo = caixaDeEscrever();
    fireEvent.change(campo, { target: { value: "   Ligar amanhã cedo.   " } });
    fireEvent.click(screen.getByRole("button", { name: /comentar/i }));

    await waitFor(() => expect(onComentar).toHaveBeenCalledWith("Ligar amanhã cedo."));
    await waitFor(() => expect(campo).toHaveValue(""));
  });

  it("publica com Ctrl + Enter", async () => {
    const onComentar = vi.fn().mockResolvedValue(undefined);
    render(<DealCardComments comentarios={[]} onComentar={onComentar} />);

    const campo = caixaDeEscrever();
    fireEvent.change(campo, { target: { value: "Fechou por telefone." } });
    fireEvent.keyDown(campo, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(onComentar).toHaveBeenCalledWith("Fechou por telefone."));
  });

  it("não publica texto em branco", () => {
    const onComentar = vi.fn();
    render(<DealCardComments comentarios={[]} onComentar={onComentar} />);

    fireEvent.change(caixaDeEscrever(), { target: { value: "    " } });
    fireEvent.click(screen.getByRole("button", { name: /comentar/i }));

    expect(onComentar).not.toHaveBeenCalled();
  });

  /**
   * A regra que existe por causa do custo, não da estética: esvaziar a caixa
   * antes de a gravação confirmar é a forma mais barata de perder o que a
   * pessoa acabou de escrever. Falhou, o texto continua lá para reenviar.
   */
  it("mantém o texto na caixa quando a gravação falha", async () => {
    const onComentar = vi.fn().mockRejectedValue(new Error("rls"));
    render(<DealCardComments comentarios={[]} onComentar={onComentar} />);

    const campo = caixaDeEscrever();
    fireEvent.change(campo, { target: { value: "Não pode sumir." } });
    fireEvent.click(screen.getByRole("button", { name: /comentar/i }));

    await waitFor(() => expect(onComentar).toHaveBeenCalled());
    expect(campo).toHaveValue("Não pode sumir.");
  });

  /**
   * Sem lead não há `lead_comments.lead_id`, que é NOT NULL. Mesma regra do
   * "+ Adicionar produto" sem `deal_id`: some a ação em vez de oferecer uma
   * que falharia no INSERT — mas o histórico continua legível.
   */
  it("sem onde gravar, lê e não escreve", () => {
    render(<DealCardComments comentarios={[comentario({ corpo: "histórico continua" })]} />);

    expect(screen.getByText("histórico continua")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /escrever comentário/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /comentar/i })).toBeNull();
  });
});

describe("Comentários no painel do Negócio — editar e apagar", () => {
  it("só oferece editar/apagar a quem pode", () => {
    render(
      <DealCardComments
        comentarios={[comentario({ id: "alheio", podeEditar: false, podeApagar: false })]}
        onEditar={vi.fn()}
        onApagar={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /editar comentário/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /apagar comentário/i })).toBeNull();
  });

  it("edita e devolve o texto novo", async () => {
    const onEditar = vi.fn().mockResolvedValue(undefined);
    render(
      <DealCardComments
        comentarios={[comentario({ id: "meu", corpo: "texto velho", podeEditar: true })]}
        onEditar={onEditar}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar comentário/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /editar comentário/i }), {
      target: { value: "texto novo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() => expect(onEditar).toHaveBeenCalledWith("meu", "texto novo"));
  });

  it("não grava edição que não mudou nada", () => {
    const onEditar = vi.fn();
    render(
      <DealCardComments
        comentarios={[comentario({ id: "meu", corpo: "igual", podeEditar: true })]}
        onEditar={onEditar}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar comentário/i }));
    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));

    expect(onEditar).not.toHaveBeenCalled();
  });

  /**
   * Confirmar apagar NÃO pode abrir um segundo overlay: o painel já é um
   * `Dialog`, e `cards-nunca-empilham.test.tsx` proíbe empilhar. A confirmação
   * acontece na própria linha.
   */
  it("confirma o apagar na própria linha, sem abrir outro diálogo", async () => {
    const onApagar = vi.fn().mockResolvedValue(undefined);
    render(
      <DealCardComments
        comentarios={[comentario({ id: "meu", podeApagar: true })]}
        onApagar={onApagar}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /apagar comentário/i }));
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /^apagar$/i }));
    await waitFor(() => expect(onApagar).toHaveBeenCalledWith("meu"));
  });

  it("dá para desistir de apagar", () => {
    const onApagar = vi.fn();
    render(
      <DealCardComments
        comentarios={[comentario({ id: "meu", podeApagar: true })]}
        onApagar={onApagar}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /apagar comentário/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(onApagar).not.toHaveBeenCalled();
    expect(screen.queryByText(/apagar este comentário\?/i)).toBeNull();
  });
});

describe("Comentários no painel do Negócio — o bloco está montado no card", () => {
  /**
   * O caso que teria pegado a regressão de 04/08: não basta o componente
   * existir, ele precisa estar DENTRO da aba que abre por padrão. Por isso a
   * asserção é sobre o `DealCard` inteiro, sem clicar em aba nenhuma.
   */
  it("aparece na aba que abre por padrão, sem precisar procurar", async () => {
    const { DealCard } = await import("@/modules/leads/components/deal-card/DealCard");
    const { NEGOCIO_ESTAGNADO } = await import("@/modules/leads/components/deal-card/fixtures");

    render(
      <DealCard
        negocio={NEGOCIO_ESTAGNADO}
        comentarios={[comentario({ corpo: "visível sem clicar em nada" })]}
        onComentar={vi.fn()}
      />,
    );

    expect(screen.getByText("Comentários")).toBeInTheDocument();
    expect(screen.getByText("visível sem clicar em nada")).toBeInTheDocument();
    expect(caixaDeEscrever()).toBeInTheDocument();
  });

  /**
   * O bloco NÃO pode emitir `<h1>`: `cards-nunca-empilham.test.tsx` conta os
   * `h1` do documento para saber quantas fichas estão abertas, e exige
   * exatamente um — o título do negócio.
   */
  it("não emite h1 — quem conta fichas abertas conta h1", async () => {
    const { DealCard } = await import("@/modules/leads/components/deal-card/DealCard");
    const { NEGOCIO_ESTAGNADO } = await import("@/modules/leads/components/deal-card/fixtures");

    render(
      <DealCard
        negocio={NEGOCIO_ESTAGNADO}
        comentarios={[comentario()]}
        onComentar={vi.fn()}
      />,
    );

    expect(Array.from(document.querySelectorAll("h1")).map((h) => h.textContent)).toEqual([
      NEGOCIO_ESTAGNADO.titulo,
    ]);
  });
});
