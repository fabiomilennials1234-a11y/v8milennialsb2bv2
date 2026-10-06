// Runs against classic/src through vitest.classic.config.ts.
/**
 * Card do Negócio — as regras que a medição de produção impôs ao card.
 *
 * Fecha metade de `inv:H8-31`: até aqui, nenhum arquivo de teste importava
 * `deal-card` ou `lead-card`. Os dois cards são a entrega da PR #1411 e
 * subiram sem uma linha de cobertura.
 *
 * O que se cobre aqui é o que quebra em produção, não a aparência:
 *
 *   1. ganhar e perder são MOVIMENTOS para etapa terminal (ADR-0023 §5) — e
 *      somem quando o funil não tem uma. São 83 funis custom nessa situação;
 *      botão que não tem para onde ir é botão que mente;
 *   2. o alerta de estagnação compara com a mediana da própria etapa, não com
 *      um número fixo. A 30 dias fixos, 22.060 dos 38.403 negócios abertos
 *      acenderiam — alarme que toca sempre não é alarme;
 *   3. a seção de dinheiro some quando não há valor. `sale_value` existe em
 *      1,1% dos 38.739 negócios; mostrar "R$ 0,00" em 98,9% das aberturas é
 *      afirmar que o negócio não vale nada, o que é diferente de não saber.
 */
import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DealCard } from "@/modules/leads/components/deal-card/DealCard";
import type { DealCardData, DealCardStage } from "@/modules/leads/components/deal-card/types";

const ETAPAS_COM_DESFECHO: DealCardStage[] = [
  { chave: "orcamento", chaveEntry: "orcamento", nome: "Orçamento", papel: "aberto" },
  { chave: "proposta_enviada", chaveEntry: "proposta_enviada", nome: "Proposta enviada", papel: "aberto" },
  { chave: "vendido", chaveEntry: "vendido", nome: "Vendido", papel: "ganho" },
  { chave: "perdido", chaveEntry: "perdido", nome: "Perdido", papel: "perdido" },
];

function negocio(over: Partial<DealCardData> = {}): DealCardData {
  return {
    id: "e1",
    titulo: "Reposição trimestral",
    estado: "aberto",
    lead: {
      id: "l1",
      nome: "Distética Suplementos",
      empresa: "Distética Comércio Ltda",
      telefone: "(11) 98472-1130",
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
    etapas: ETAPAS_COM_DESFECHO,
    etapaAtual: "proposta_enviada",
    dono: "Luiza Andrade",
    diasEmAberto: 96,
    diasNaEtapa: 10,
    medianaDaEtapa: 21,
    valor: 0,
    moeda: "BRL",
    produto: null,
    reuniao: null,
    desfecho: null,
    movimentacoes: [],
    nota: "",
    // ── Campos do painel de duas colunas ──────────────────────────────────
    // `itens` NÃO pode faltar: `contaDoNegocio` soma a lista, e sem ela o
    // painel inteiro morre com "Cannot read properties of undefined". Como
    // `tsconfig.app.json` só inclui `src`, esta pasta não é checada por tipo
    // e um fixture defasado passa a compilar e só explode em tempo de teste.
    valorDoNegocio: null,
    probabilidade: null,
    previsaoFechamento: null,
    fechadoEm: null,
    criadoEm: null,
    itens: [],
    atividades: [],
    outrosNegocios: [],
    ...over,
  };
}


it("o card encaminha a recarga da proposta e mantém a versão rejeitada bloqueada", async () => {
  const salvar = vi.fn().mockRejectedValueOnce({ code: "PT409", message: "stale", details: null, hint: null }).mockResolvedValue(undefined);
  const recarregar = vi.fn().mockResolvedValue(undefined);
  const props = { onEditarValor: salvar, onRecarregarValor: recarregar };
  const { rerender } = render(<DealCard {...props} negocio={negocio({ valor: 100, valorDoNegocio: 100, pedidoAtualizadoEm: "v1" })} />);
  fireEvent.click(screen.getByRole("button", { name: "Editar valor" }));
  fireEvent.change(screen.getByLabelText("Valor da proposta"), { target: { value: "15000" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar valor" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar valor" })).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Atualizar valor" }));
  await waitFor(() => expect(recarregar).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Editar valor" })).toBeDisabled();
  rerender(<DealCard {...props} negocio={negocio({ valor: 200, valorDoNegocio: 200, pedidoAtualizadoEm: "v2" })} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar valor" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Editar valor" }));
  fireEvent.change(screen.getByLabelText("Valor da proposta"), { target: { value: "25000" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar valor" }));
  await waitFor(() => expect(salvar).toHaveBeenLastCalledWith(250, "v2"));
});
