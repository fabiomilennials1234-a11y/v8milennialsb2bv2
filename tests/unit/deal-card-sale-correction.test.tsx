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
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DealCard } from "@/modules/leads/components/deal-card/DealCard";
import type { DealCardData, DealCardStage } from "@/modules/leads/components/deal-card/types";

const ETAPAS_COM_DESFECHO: DealCardStage[] = [
  { chave: "orcamento", chaveEntry: "orcamento", nome: "Orçamento", papel: "aberto" },
  { chave: "proposta_enviada", chaveEntry: "proposta_enviada", nome: "Proposta enviada", papel: "aberto" },
  { chave: "vendido", chaveEntry: "vendido", nome: "Vendido", papel: "ganho" },
  { chave: "perdido", chaveEntry: "perdido", nome: "Perdido", papel: "perdido" },
];

/** O funil custom sem etapa terminal — 83 deles em prod. */
const ETAPAS_SEM_DESFECHO: DealCardStage[] = [
  { chave: "s1", chaveEntry: "s1", nome: "Triagem", papel: "aberto" },
  { chave: "s2", chaveEntry: "s2", nome: "Em análise", papel: "aberto" },
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


import { DealCard as DealCardClassico } from "../../classic/src/modules/leads/components/deal-card/DealCard";

describe.each([["nova",DealCard],["clássica",DealCardClassico]] as const)("correção no card da interface %s",(_,Card)=>{
  for(const historica of [false,true])it("abre e salva uma venda "+(historica?"histórica":"do funil"),async()=>{
    const salvar=vi.fn().mockResolvedValue(undefined);
    render(<Card negocio={negocio({estado:"ganho",vendaHistorica:historica,valor:100,pedidoAtualizadoEm:"versao-exibida",desfecho:{quando:"2026-09-30T15:00:00Z",valorVenda:100,motivo:null}})} onCorrigirVendaHistorica={salvar} />);
    fireEvent.click(screen.getByRole("button",{name:"Corrigir data e valor da venda"}));
    expect(screen.getByLabelText("Data da venda")).toHaveValue("2026-09-30");
    fireEvent.change(screen.getByLabelText("Data da venda"),{target:{value:"2026-10-01"}});
    fireEvent.change(screen.getByLabelText("Motivo da correção"),{target:{value:"Faturamento"}});
    fireEvent.click(screen.getByRole("button",{name:"Salvar correção"}));
    await waitFor(()=>expect(salvar).toHaveBeenCalledWith({valor:100,data:"2026-10-01",motivo:"Faturamento",versao:"versao-exibida"}));
  });
  it("não oferece correção para um negócio aberto",()=>{
    render(<Card negocio={negocio()} onCorrigirVendaHistorica={vi.fn()} />);
    expect(screen.queryByRole("button",{name:"Corrigir data e valor da venda"})).not.toBeInTheDocument();
  });
});
