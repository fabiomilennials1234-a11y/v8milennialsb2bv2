/**
 * "Registrar venda" — o bloco de valor não oferece o que o banco sempre recusa.
 *
 * Riofix (prod, 2026-10-01): card em "Vendido" sem negócio, clique em "Definir
 * valor", toast "Somente propostas abertas podem receber valor manual". Desde
 * 03/09 a etapa não decide desfecho, e `editar_valor_proposta` recusa de
 * propósito entrada sem negócio em etapa terminal e negócio encerrado.
 *
 * O que se trava aqui:
 *   1. a decisão (`acaoDoValor`) — uma tabela, num lugar só;
 *   2. card em etapa de ganho SEM negócio → "Registrar venda", que manda o
 *      valor PARSEADO para o caminho do desfecho e nunca para o de editar;
 *   3. card em perda sem negócio, ou negócio encerrado → nenhum botão de valor;
 *   4. negócio aberto (qualquer etapa) ou etapa não-final → "Definir/Editar
 *      valor" como sempre — inclusive em etapa de ganho, onde o banco aceita;
 *   5. `sale_value` já gravado vai como está: `definir_desfecho_da_entrada` faz
 *      `COALESCE(value, p_valor)`, então um campo editável ali mentiria;
 *   6. a etapa terminal pelas flags `is_final_*` (campo `terminal`) conta
 *      mesmo com `papel` aberto — é o que o banco consulta;
 *   7. etapa de REUNIÃO com `is_final_positive` (263 entradas sem negócio em
 *      prod: "Agendado ✓", "Compareceu ✓") não é venda: nenhum botão, nem o
 *      de registrar (caderno de vendas é append-only) nem o de editar (o banco
 *      recusa);
 *   8. `registrarVendaPor` — o `false` do desfecho vira `throw`, que é o que
 *      mantém o rascunho no campo.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DealCard } from "@/modules/leads/components/deal-card/DealCard";
import {
  acaoDoValor,
  registrarVendaPor,
  terminalDaEtapa,
} from "@/modules/leads/components/deal-card/acao-do-valor";
import type { DealCardData, DealCardStage } from "@/modules/leads/components/deal-card/types";

const ETAPAS: DealCardStage[] = [
  { chave: "proposta", chaveEntry: "proposta", nome: "Proposta enviada", papel: "aberto" },
  { chave: "vendido", chaveEntry: "vendido", nome: "Vendido", papel: "ganho" },
  { chave: "perdido", chaveEntry: "perdido", nome: "Perdido", papel: "perdido" },
];

function negocio(over: Partial<DealCardData> = {}): DealCardData {
  return {
    id: "e1",
    dealId: null,
    titulo: "Reposição trimestral",
    estado: "aberto",
    lead: {
      id: "l1",
      nome: "Distética Suplementos",
      empresa: null,
      telefone: null,
      relacao: "lead",
      email: null,
      origem: null,
      chegouEm: null,
      qualificacao: null,
      preQualificacao: null,
      responsaveis: { preVenda: null, venda: null },
      etiquetas: [],
      faturamento: null,
    },
    funil: "Orçamentos",
    funilCor: "#a855f7",
    etapas: ETAPAS,
    etapaAtual: "proposta",
    dono: null,
    diasEmAberto: 3,
    diasNaEtapa: 1,
    medianaDaEtapa: null,
    valor: 0,
    moeda: "BRL",
    produto: null,
    reuniao: null,
    desfecho: null,
    movimentacoes: [],
    nota: "",
    valorDoNegocio: null,
    pedidoAtualizadoEm: null,
    probabilidade: null,
    previsaoFechamento: null,
    fechadoEm: null,
    criadoEm: null,
    itens: [],
    atividades: [],
    outrosNegocios: [],
    ...over,
  } as DealCardData;
}

describe("acaoDoValor — a tabela da decisão", () => {
  const casos: Array<[string, Partial<DealCardData>, ReturnType<typeof acaoDoValor>]> = [
    ["ganho sem negócio", { etapaAtual: "vendido", dealId: null }, "registrar-venda"],
    ["ganho com negócio aberto (o banco aceita)", { etapaAtual: "vendido", dealId: "d1" }, "editar"],
    ["perda sem negócio", { etapaAtual: "perdido", dealId: null }, null],
    ["perda com negócio aberto (o banco aceita)", { etapaAtual: "perdido", dealId: "d1" }, "editar"],
    ["negócio ganho", { estado: "ganho", etapaAtual: "vendido", dealId: "d1" }, null],
    ["negócio perdido", { estado: "perdido", etapaAtual: "proposta", dealId: "d1" }, null],
    ["aberto em etapa não-final", { etapaAtual: "proposta" }, "editar"],
    ["etapa fora da trilha", { etapaAtual: "sumiu" }, "editar"],
    [
      "flag is_final_positive com stage_role aberto",
      {
        etapaAtual: "vendido_legado",
        etapas: [{ chave: "vendido_legado", chaveEntry: "vendido_legado", nome: "Vendido", papel: "aberto", terminal: "ganho" }],
      },
      "registrar-venda",
    ],
    [
      "etapa de reunião com is_final_positive (Agendado ✓ / Compareceu ✓)",
      {
        etapaAtual: "compareceu",
        etapas: [{ chave: "compareceu", chaveEntry: "compareceu", nome: "Compareceu ✓", papel: "aberto", terminal: "reuniao-final" }],
      },
      null,
    ],
    [
      "reunião final com negócio aberto (o banco aceita)",
      {
        etapaAtual: "compareceu",
        dealId: "d1",
        etapas: [{ chave: "compareceu", chaveEntry: "compareceu", nome: "Compareceu ✓", papel: "aberto", terminal: "reuniao-final" }],
      },
      "editar",
    ],
    [
      "terminal explícito null vence o papel",
      {
        etapaAtual: "x",
        etapas: [{ chave: "x", chaveEntry: "x", nome: "X", papel: "ganho", terminal: null }],
      },
      "editar",
    ],
  ];
  it.each(casos)("%s", (_nome, over, esperado) => {
    expect(acaoDoValor(negocio(over))).toBe(esperado);
  });
});

describe("terminalDaEtapa — o que o banco trata como terminal", () => {
  const casos: Array<[unknown, unknown, unknown, ReturnType<typeof terminalDaEtapa>]> = [
    // role, is_final_positive, is_final_negative, esperado
    ["won", false, false, "ganho"],
    ["won", null, null, "ganho"],
    ["lost", false, false, "perdido"],
    ["lost", true, false, "perdido"],
    ["open", true, false, "ganho"], // Riofix "Vendido"
    [null, true, false, "ganho"],
    [undefined, true, false, "ganho"],
    ["meeting_booked", true, false, "reuniao-final"], // "Agendado ✓"
    ["meeting_held", true, false, "reuniao-final"], // "Compareceu ✓"
    ["meeting_held", false, true, "perdido"],
    ["open", false, true, "perdido"],
    ["open", true, true, "perdido"],
    ["open", false, false, null],
    ["meeting_booked", false, false, null],
    [null, null, null, null],
    ["open", "true", false, null], // só o booleano conta
  ];
  it.each(casos)("role=%s pos=%s neg=%s → %s", (role, pos, neg, esperado) => {
    expect(terminalDaEtapa(role, pos, neg)).toBe(esperado);
  });
});

describe("registrarVendaPor — o caminho do painel", () => {
  it("manda 'won' com o valor e resolve quando o desfecho grava", async () => {
    const definir = vi.fn().mockResolvedValue(true);
    await expect(registrarVendaPor(definir)(1234.56)).resolves.toBeUndefined();
    expect(definir).toHaveBeenCalledWith("won", 1234.56);
  });

  it("desfecho não gravado vira throw — o campo não fecha", async () => {
    const definir = vi.fn().mockResolvedValue(false);
    await expect(registrarVendaPor(definir)(10)).rejects.toThrow("venda-nao-registrada");
  });

  it("desfecho recusado mantém o rascunho no card", async () => {
    const registrar = registrarVendaPor(vi.fn().mockResolvedValue(false));
    render(<DealCard negocio={negocio({ etapaAtual: "vendido" })} onRegistrarVenda={registrar} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar venda" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor da venda" }), {
      target: { value: "5000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venda" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirmar venda" })).not.toBeDisabled(),
    );
    expect(screen.getByRole("textbox", { name: "Valor da venda" })).toHaveValue("50,00");
  });
});

describe("bloco de valor no card", () => {
  it("etapa de ganho sem negócio: Registrar venda manda 'won' com o valor parseado", async () => {
    const registrar = vi.fn().mockResolvedValue(undefined);
    const editar = vi.fn();
    render(
      <DealCard
        negocio={negocio({ etapaAtual: "vendido" })}
        onRegistrarVenda={registrar}
        onEditarValor={editar}
      />,
    );

    expect(screen.queryByRole("button", { name: "Definir valor" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar venda" }));

    const confirmar = screen.getByRole("button", { name: "Confirmar venda" });
    expect(confirmar).toBeDisabled(); // campo vazio não registra venda
    fireEvent.change(screen.getByRole("textbox", { name: "Valor da venda" }), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venda" }));

    await waitFor(() => expect(registrar).toHaveBeenCalledWith(1234.56));
    expect(editar).not.toHaveBeenCalled();
  });

  it("sale_value já gravado vai como está — sem campo editável que o banco ignoraria", async () => {
    const registrar = vi.fn().mockResolvedValue(undefined);
    render(
      <DealCard
        negocio={negocio({ etapaAtual: "vendido", valor: 500 })}
        onRegistrarVenda={registrar}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Registrar venda" }));
    expect(screen.queryByRole("textbox", { name: "Valor da venda" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venda" }));
    await waitFor(() => expect(registrar).toHaveBeenCalledWith(500));
  });

  it("falha ao registrar preserva o rascunho", async () => {
    const registrar = vi.fn().mockRejectedValue(new Error("falhou"));
    render(<DealCard negocio={negocio({ etapaAtual: "vendido" })} onRegistrarVenda={registrar} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar venda" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor da venda" }), {
      target: { value: "9900" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venda" }));
    await waitFor(() => expect(registrar).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Valor da venda" })).toHaveValue("99,00"),
    );
  });

  it("etapa de perda sem negócio: nenhum botão de valor", () => {
    render(
      <DealCard
        negocio={negocio({ etapaAtual: "perdido" })}
        onRegistrarVenda={vi.fn()}
        onEditarValor={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Definir valor" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar valor" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar venda" })).toBeNull();
  });

  it("etapa de reunião final sem negócio: nenhum botão de valor", () => {
    render(
      <DealCard
        negocio={negocio({
          etapaAtual: "agendado",
          etapas: [
            ...ETAPAS,
            { chave: "agendado", chaveEntry: "agendado", nome: "Agendado ✓", papel: "aberto", terminal: "reuniao-final" },
          ],
        })}
        onRegistrarVenda={vi.fn()}
        onEditarValor={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Definir valor" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar venda" })).toBeNull();
  });

  it("negócio ganho: nenhum botão de valor", () => {
    render(
      <DealCard
        negocio={negocio({ estado: "ganho", etapaAtual: "vendido", dealId: "d1", valorDoNegocio: 500 })}
        onRegistrarVenda={vi.fn()}
        onEditarValor={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Editar valor" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar venda" })).toBeNull();
  });

  it("negócio aberto em etapa de ganho: Editar valor segue indo para editar", async () => {
    const editar = vi.fn().mockResolvedValue(undefined);
    const registrar = vi.fn();
    render(
      <DealCard
        negocio={negocio({ etapaAtual: "vendido", dealId: "d1", valorDoNegocio: 300, pedidoAtualizadoEm: "v1" })}
        onRegistrarVenda={registrar}
        onEditarValor={editar}
      />,
    );
    expect(screen.queryByRole("button", { name: "Registrar venda" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editar valor" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor da proposta" }), {
      target: { value: "45000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar valor" }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith(450, "v1"));
    expect(registrar).not.toHaveBeenCalled();
  });

  it("aberto em etapa não-final: Definir valor segue indo para editar", async () => {
    const editar = vi.fn().mockResolvedValue(undefined);
    const registrar = vi.fn();
    render(
      <DealCard negocio={negocio()} onRegistrarVenda={registrar} onEditarValor={editar} />,
    );
    expect(screen.queryByRole("button", { name: "Registrar venda" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Definir valor" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor da proposta" }), {
      target: { value: "70000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar valor" }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith(700, null));
    expect(registrar).not.toHaveBeenCalled();
  });
});
